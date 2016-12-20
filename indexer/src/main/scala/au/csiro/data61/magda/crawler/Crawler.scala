package au.csiro.data61.magda.crawler

import akka.actor.ActorSystem

import au.csiro.data61.magda.external.InterfaceConfig
import com.typesafe.config.Config
import au.csiro.data61.magda.external.ExternalInterface
import au.csiro.data61.magda.AppConfig
import akka.event.Logging
import akka.stream.OverflowStrategy
import akka.stream.scaladsl.Source
import akka.stream.scaladsl.Merge
import au.csiro.data61.magda.search.elasticsearch.ElasticSearchIndexer
import au.csiro.data61.magda.search.SearchIndexer
import akka.stream.scaladsl.Sink
import akka.stream.Materializer
import scala.concurrent.duration._
import akka.stream.ThrottleMode
import scala.concurrent.Future
import au.csiro.data61.magda.model.misc.DataSet
import akka.NotUsed

class Crawler(system: ActorSystem, config: Config, val externalInterfaces: Seq[InterfaceConfig], materializer: Materializer, indexer: SearchIndexer) {
  val log = Logging(system, getClass)
  implicit val ec = system.dispatcher
  implicit val m = materializer

  val interfaces = externalInterfaces
    .groupBy(_.baseUrl)
    .mapValues(interfaceDef =>
      ExternalInterface(interfaceDef.head)(system, system.dispatcher, materializer)
    )

  def crawl() = {
    externalInterfaces
      .map { interface =>
        val needsIndexingFuture = if (AppConfig.conf.getBoolean("indexer.alwaysReindex")) {
          log.info("Indexing {} because indexer.alwaysReindex is true", interface.name)
          Future(true)
        } else {
          indexer.needsReindexing(interface).map { needsReindexing =>
            if (needsReindexing) {
              log.info("Indexing {} because it was determined to have zero records", interface.name)
            } else {
              log.info("Not indexing {} because it already has records", interface.name)
            }
            needsReindexing
          }
        }

        Source.fromFuture(needsIndexingFuture)
          .flatMapConcat { needsReindexing => if (needsReindexing) streamForInterface(interface) else Source.empty[(InterfaceConfig, List[DataSet])] }
      }
      .reduce((x, y) => Source.combine(x, y)(Merge(_)))
      .map {
        case (source, dataSets) =>
          val filteredDataSets = dataSets.filterNot(_.distributions.isEmpty)

          val ineligibleDataSetCount = dataSets.size - filteredDataSets.size
          if (ineligibleDataSetCount > 0) {
            log.info("Filtering out {} datasets from {} because they have no distributions", ineligibleDataSetCount, source.name)
          }

          (source, filteredDataSets)
      }
      .mapAsync(1) {
        case (source, dataSets) =>
          indexer.index(source, dataSets)
            .map(_ => (source, dataSets))
            .recover {
              case e: Throwable =>
                log.error(e, "Failed while indexing")
                (source, Nil)
            }
      }
      .runWith(Sink.fold(0)((a, b) => a + b._2.size))
      .map { size =>
        if (size > 0) {
          log.info("Indexed {} datasets", size)
          if (config.getBoolean("indexer.makeSnapshots")) {
            log.info("Snapshotting...")
            indexer.snapshot()
          }
        } else {
          log.info("Did not need to index anything, no need to snapshot either.")
        }
      }
      .recover {
        case e: Throwable =>
          log.error(e, "Failed crawl")
      }
  }

  def streamForInterface(interfaceDef: InterfaceConfig): Source[(InterfaceConfig, List[DataSet]), NotUsed] = {
    val interface = interfaces.get(interfaceDef.baseUrl).get

    Source.fromFuture(interface.getTotalDataSetCount())
      .mapConcat { count =>
        log.info("{} has {} datasets", interfaceDef.baseUrl, count)
        val maxFromConfig = if (AppConfig.conf.hasPath("crawler.maxResults")) AppConfig.conf.getLong("crawler.maxResults") else Long.MaxValue
        createBatches(interfaceDef, 0, Math.min(maxFromConfig, count))
      }
      .throttle(1, 1 second, 1, ThrottleMode.Shaping)
      .mapAsync(1) {
        case (start, size) => interface.getDataSets(start, size).map((interfaceDef, _))
      }
      .recover {
        case e: Throwable =>
          log.error(e, "Failed while fetching from {}", interfaceDef.name)
          (interfaceDef, Nil)
      }
  }

  def createBatches(interfaceDef: InterfaceConfig, start: Long, end: Long): List[(Long, Int)] = {
    val length = end - start
    if (length <= 0) {
      Nil
    } else {
      val nextPageSize = math.min(interfaceDef.pageSize, length).toInt
      (start, nextPageSize) :: createBatches(interfaceDef, start + nextPageSize, end)
    }
  }
}