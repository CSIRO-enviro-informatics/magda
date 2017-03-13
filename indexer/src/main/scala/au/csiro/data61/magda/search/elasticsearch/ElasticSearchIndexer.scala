package au.csiro.data61.magda.search.elasticsearch

import java.time.{ Instant, OffsetDateTime }

import akka.actor.ActorSystem
import akka.stream.{ Materializer, OverflowStrategy, QueueOfferResult }
import akka.stream.scaladsl.{ Sink, Source, SourceQueue }
import au.csiro.data61.magda.external.InterfaceConfig
import au.csiro.data61.magda.model.misc.{ DataSet, Format, Publisher }
import au.csiro.data61.magda.search.SearchIndexer
import au.csiro.data61.magda.search.elasticsearch.ElasticSearchImplicits._
import au.csiro.data61.magda.util.ErrorHandling.{ RootCause, retry }
import com.sksamuel.elastic4s.ElasticDsl._
import com.sksamuel.elastic4s.mappings.GetMappingsResult
import org.elasticsearch.action.admin.cluster.repositories.put.PutRepositoryResponse
import org.elasticsearch.action.admin.cluster.snapshots.create.CreateSnapshotResponse
import org.elasticsearch.action.admin.cluster.snapshots.get.GetSnapshotsResponse
import org.elasticsearch.index.IndexNotFoundException
import org.elasticsearch.repositories.RepositoryMissingException
import org.elasticsearch.rest.RestStatus
import org.elasticsearch.snapshots.SnapshotInfo
import org.elasticsearch.transport.RemoteTransportException
import spray.json._
import org.elasticsearch.action.bulk.{ BulkResponse }
import com.sksamuel.elastic4s.bulk.BulkDefinition
import com.sksamuel.elastic4s.TcpClient
import com.sksamuel.elastic4s.ElasticDsl

import scala.collection.JavaConversions._
import scala.concurrent.{ ExecutionContext, Future, Promise }
import scala.concurrent.duration._
import scala.util.{ Failure, Success }
import com.typesafe.config.Config
import com.sksamuel.elastic4s.bulk.RichBulkResponse
import org.elasticsearch.action.bulk.BulkItemResponse
import com.sksamuel.elastic4s.bulk.RichBulkItemResponse

class ElasticSearchIndexer(
    val clientProvider: ClientProvider,
    val indices: Indices)(
        implicit val config: Config,
        implicit val system: ActorSystem,
        implicit val ec: ExecutionContext,
        implicit val materializer: Materializer) extends SearchIndexer {
  val logger = system.log
  val SNAPSHOT_REPO_NAME = "snapshots"

  /**
   * Returns an initialised {@link TcpClient} on completion. Using this to get the client rather than just keeping a reference to an initialised client
   *  ensures that all queries will only complete after the client is initialised.
   */
  private val setupFuture = setup()

  implicit val scheduler = system.scheduler

  override def ready = setupFuture.map(_ => Unit)

  // This needs to be a queue here because if we queue more than 50 requests into ElasticSearch it gets very very mad.
  private lazy val indexQueue: SourceQueue[(InterfaceConfig, Seq[DataSet], Promise[Unit])] =
    Source.queue[(InterfaceConfig, Seq[DataSet], Promise[Unit])](Int.MaxValue, OverflowStrategy.backpressure)
      .mapAsync(1) {
        case (source, dataSets, promise) =>
          val onRetry = (retryCount: Int, e: Throwable) => logger.error("Failed to index from {}, retrying", source.name, e)

          retry(() => bulkIndex(buildDatasetIndexDefinition(source, dataSets)), 30 seconds, 4, onRetry)
            .map((source, dataSets, promise, _))
            .recover {
              case e: Throwable =>
                promise.failure(e)
                throw e
            }
      }
      .map {
        case (source, dataSets, promise, result) =>
          if (result.hasFailures) {
            logger.warning("Failure when indexing from {}: {}", source.name, result.failureMessage)

            reindexSpatialFails(source, dataSets, result.failures, promise)
          } else {
            logger.info("Indexed {} datasets from {}", dataSets.length, source.name)
            promise.success(result)
          }
      }
      .recover {
        case e: Throwable =>
          logger.error(e, "Error when indexing: {}", e.getMessage)
          throw e
      }
      .to(Sink.last)
      .run()

  private lazy val restoreQueue: SourceQueue[(TcpClient, IndexDefinition, SnapshotInfo, Promise[RestoreResult])] =
    Source.queue[(TcpClient, IndexDefinition, SnapshotInfo, Promise[RestoreResult])](Int.MaxValue, OverflowStrategy.backpressure)
      .mapAsync(1) {
        case (client, definition, snapshot, promise) =>
          logger.info("Restoring snapshot {} for {} version {}", snapshot.snapshotId.getName, definition.name, definition.version)

          logger.info("First deleting existing index if present...")

          deleteIndex(client, definition).map(_ => (client, definition, snapshot, promise))
      }
      .mapAsync(1) {
        case (client, definition, snapshot, promise) =>
          logger.info("Restoring snapshot")

          client.execute {
            restore snapshot snapshot.snapshotId.getName from SNAPSHOT_REPO_NAME indexes indices.getIndex(config, Indices.DataSetsIndex) waitForCompletion true
          } map { response =>
            response.status match {
              case RestStatus.OK =>
                logger.info("Restored {} version {}", definition.name, definition.version)
                promise.success(RestoreSuccess)
              case status: RestStatus =>
                logger.info("Failed to restore for {} version {} with status {}", definition.name, definition.version, status)
                promise.success(RestoreFailure)
            }
          }
      }
      .recover {
        case e: Throwable =>
          logger.error(e, "Error when restoring: {}", e.getMessage)
      }
      .to(Sink.last)
      .run()

  /** Initialises an {@link TcpClient}, handling initial connection to the ElasticSearch server and creation of the indices */
  private def setup(): Future[TcpClient] = {
    clientProvider.getClient(system.scheduler, logger, ec).flatMap(client =>
      retry(() => getIndexDefinitions(client), 10 seconds, config.getInt("indexer.connectionRetries"), logger.error("Failed to get indexes, {} retries left", _, _))
        .flatMap { indexPairs =>
          updateIndices(client, indexPairs)
            .map { _ =>
              // If we've got to here everything has gone swimmingly - the index is all ready to have data loaded, so return the client for other methods to play with :)
              client
            }
        }
    )
  }

  private def reindexSpatialFails(source: InterfaceConfig, dataSets: Seq[DataSet], failures: Seq[RichBulkItemResponse], promise: Promise[Unit]) = {
    val dataSetLookup = dataSets.groupBy(_.identifier).mapValues(_.head)
    val geoFails = failures
      .filter(_.failureMessage.contains("failed to parse [spatial.geoJson]"))
      .map(result => dataSetLookup.get(result.id.split("%2F")(1)))
      .flatten
      .map(dataSet => dataSet.copy(spatial = dataSet.spatial.map(spatial => spatial.copy(geoJson = None))))

    if (geoFails.length > 0) {
      logger.info("Determined that {} datasets were excluded due to bad geojson - trying these again with spatial.geoJson excluded", geoFails.length)
      index(source, geoFails.toList, promise)
    } else {
      promise.failure(new Exception(s"Had failures other than geoJson parse: ${failures.map(_.failureMessage).mkString("\n")}"))
    }
  }

  /**
   * Returns a future that gets a seq of each index paired with its current ES definition.
   */
  private def getIndexDefinitions(client: TcpClient) = {
    def indexNotFound(indexDef: IndexDefinition, inner: IndexNotFoundException) = {
      logger.warning("{} index was not present, if this is the first boot with a new index version this is fine: {}", indexDef.name, inner.getMessage)
      None
    }

    Future.sequence(
      IndexDefinition.indices.map(indexDef =>
        client.execute(getMapping(indices.getIndex(config, indexDef.indicesIndex)))
          .map(Some(_))
          .recover {
            // If the index wasn't found that's fine, we'll just recreate it. Otherwise log an error - every subsequent request to the provider will fail with this exception.
            case RootCause(inner: IndexNotFoundException) => indexNotFound(indexDef, inner)
          }))
      .map(esDefinitions => esDefinitions.zip(IndexDefinition.indices))
  }

  private def updateIndices(client: TcpClient, definitionPairs: Seq[(Option[GetMappingsResult], IndexDefinition)]): Future[Object] =
    Future.sequence(definitionPairs.map {
      case (mapping, definition) =>
        // If no index, create it
        mapping match {
          case Some(_) =>
            logger.info("{} index version {} already exists", definition.name, definition.version)
            Future.successful(Unit)
          case None =>
            logger.info("{} index version {} does not exist, creating", definition.name, definition.version)
            buildIndex(client, definition)
        }
    })

  private def buildIndex(client: TcpClient, definition: IndexDefinition): Future[Any] = {
    val snapshotFuture = if (config.getBoolean("indexer.readSnapshots"))
      restoreLatestSnapshot(client, definition)
    else {
      logger.info("Snapshot restoration disabled, rebuilding index manually")
      Future(RestoreFailure)
    }

    snapshotFuture flatMap {
      case RestoreSuccess => Future.successful(Unit) // no need to reindex 
      case RestoreFailure =>
        deleteIndex(client, definition)
          .flatMap { _ =>
            client.execute(definition.definition(indices, config))
          } recover {
            case e: Throwable =>
              logger.error(e, "Failed to set up the index")
              throw e
          } flatMap { _ =>
            logger.info("Index {} version {} created", definition.name, definition.version)

            definition.create match {
              case Some(createFunc) => createFunc(client, indices, config)(materializer, system)
                .flatMap(_ =>
                  if (config.getBoolean("indexer.makeSnapshots"))
                    createSnapshot(client, definition)
                  else {
                    logger.info("Snapshotting disabled, skipping")
                    Future(Unit)
                  }
                )
              case None => Future(Unit)
            }
          }
    }
  }

  def deleteIndex(client: TcpClient, definition: IndexDefinition): Future[Unit] = client.execute {
    ElasticDsl.deleteIndex(indices.getIndex(config, definition.indicesIndex))
  } recover {
    case RootCause(inner: IndexNotFoundException) => // Meh, we were trying to delete it anyway.
    case e =>
      logger.debug("Exception class {}", e.getClass.toString)
      throw e
  } map { _ =>
    Unit
  }

  sealed trait RestoreResult
  case object RestoreSuccess extends RestoreResult
  case object RestoreFailure extends RestoreResult

  private def restoreLatestSnapshot(client: TcpClient, index: IndexDefinition): Future[RestoreResult] = {
    logger.info("Attempting to restore snapshot for {} version {}", index.name, index.version)

    getLatestSnapshot(client, index) flatMap {
      case None =>
        logger.info("Could not find a snapshot for {} version {}", index.name, index.version)
        Future.successful(RestoreFailure)
      case Some(snapshot) =>
        logger.info("Found snapshot {} for {} version {}, queueing restore operation", snapshot.snapshotId.getName, index.name, index.version)
        val promise = Promise[RestoreResult]()
        restoreQueue.offer((client, index, snapshot, promise))
        promise.future
    }
  }

  private def getLatestSnapshot(client: TcpClient, index: IndexDefinition): Future[Option[SnapshotInfo]] = {
    def getSnapshot(): Future[GetSnapshotsResponse] = client.execute {
      get snapshot Seq() from SNAPSHOT_REPO_NAME
    }

    getSnapshot()
      .map(x => Future.successful(x))
      .recover {
        case RootCause(e: RepositoryMissingException) =>
          createSnapshotRepo(client, index).flatMap(_ => getSnapshot)
        case e: Throwable => throw new RuntimeException(e)
      }
      .flatMap(identity)
      .map { response =>
        response.getSnapshots
          .view
          .filter(_.snapshotId.getName.startsWith(snapshotPrefix(index)))
          .filter(_.failedShards() == 0)
          .sortBy(-_.endTime)
          .headOption
      }
  }

  private def createSnapshotRepo(client: TcpClient, definition: IndexDefinition): Future[PutRepositoryResponse] = {
    val repoConfig = config.getConfig("elasticSearch.snapshotRepo")
    val repoType = repoConfig.getString("type")
    val settings = repoConfig.getConfig("types." + repoType).entrySet().map { case entry => (entry.getKey, entry.getValue().unwrapped()) } toMap

    client.execute(
      create repository SNAPSHOT_REPO_NAME `type` repoType settings settings
    )
  }

  private def snapshotPrefix(definition: IndexDefinition) = s"${definition.name}-${definition.version}"

  private def getYears(from: Option[OffsetDateTime], to: Option[OffsetDateTime]): Option[String] = {
    val newFrom = from.orElse(to).map(_.getYear)
    val newTo = to.orElse(from).map(_.getYear)

    (newFrom, newTo) match {
      case (Some(newFrom), Some(newTo)) => Some(s"$newFrom-$newTo")
      case _                            => None
    }
  }

  override def index(source: InterfaceConfig, dataSets: List[DataSet]) = index(source, dataSets, Promise[Unit]())

  def index(source: InterfaceConfig, dataSets: List[DataSet], promise: Promise[Unit]) = {
    // TODO: Check for empty identifier strings.

    if (dataSets.length > 0) {
      indexQueue.offer((source, dataSets, promise))
        .map {
          case QueueOfferResult.Enqueued    => QueueOfferResult.Enqueued
          case QueueOfferResult.Dropped     => throw new Exception("Dropped")
          case QueueOfferResult.QueueClosed => throw new Exception("Queue Closed")
          case QueueOfferResult.Failure(e)  => throw e
        }
    } else {
      promise.success(Unit)
    }

    promise.future
  }

  def snapshot(): Future[Unit] = setupFuture.flatMap(client => createSnapshot(client, IndexDefinition.dataSets)).map(_ => Unit)

  private def createSnapshot(client: TcpClient, definition: IndexDefinition): Future[CreateSnapshotResponse] = {
    logger.info("Creating snapshot for {} at version {}", definition.name, definition.version)

    val future = client.execute {
      create snapshot snapshotPrefix(definition) + "-" + Instant.now().toString.toLowerCase in SNAPSHOT_REPO_NAME waitForCompletion true indexes indices.getIndex(config, definition.indicesIndex)
    }

    future.onComplete {
      case Success(result) =>
        val info = result.getSnapshotInfo
        logger.info("Snapshotted {} shards of {} for {}", info.successfulShards(), info.totalShards(), indices.getIndex(config, definition.indicesIndex))
      case Failure(e) => logger.error(e, "Failed to snapshot {}", indices.getIndex(config, definition.indicesIndex))
    }

    future
  }

  override def needsReindexing(source: InterfaceConfig): Future[Boolean] = {
    setupFuture.flatMap(client =>
      retry(() =>
        client.execute {
          ElasticDsl.search in indices.getIndex(config, Indices.DataSetsIndex) / indices.getType(Indices.DataSetsIndexType) query matchQuery("catalog", source.name) limit 0
        }, 10 seconds, 10, logger.error("Failed to get dataset count, {} retries left", _, _))
        .map { result =>
          logger.debug("{} reindex check hit count: {}", source.name, result.getHits.getTotalHits)
          result.getHits.getTotalHits == 0
        }
    )
  }

  private def bulkIndex(definition: BulkDefinition): Future[RichBulkResponse] =
    setupFuture.flatMap { client =>
      client.execute(definition)
        .recover {
          case t: Throwable =>
            logger.error(t, "Error when indexing records")
            throw t
        }
    }

  /**
   * Indexes a number of datasets into ES using a bulk insert.
   */
  private def buildDatasetIndexDefinition(source: InterfaceConfig, dataSets: Seq[DataSet]): BulkDefinition =
    bulk(
      dataSets.map { dataSet =>
        val indexDataSet = ElasticDsl.index into indices.getIndex(config, Indices.DataSetsIndex) / indices.getType(Indices.DataSetsIndexType) id dataSet.uniqueId source (
          dataSet.copy(
            catalog = source.name,
            years = ElasticSearchIndexer.getYears(dataSet.temporal.flatMap(_.start.flatMap(_.date)), dataSet.temporal.flatMap(_.end.flatMap(_.date)))
          ).toJson
        )

        val indexPublisher = dataSet.publisher.flatMap(_.name.map(publisherName =>
          ElasticDsl.index into indices.getIndex(config, Indices.DataSetsIndex) / Publisher.id
            id publisherName.toLowerCase
            source Map("value" -> publisherName).toJson))

        val indexFormats = dataSet.distributions.filter(_.format.isDefined).map { distribution =>
          val format = distribution.format.get

          ElasticDsl.index into indices.getIndex(config, Indices.DataSetsIndex) / Format.id id format.toLowerCase source Map("value" -> format).toJson
        }

        indexDataSet :: indexPublisher.toList ++ indexFormats
      }.flatten)

}

object ElasticSearchIndexer {
  def getYears(from: Option[OffsetDateTime], to: Option[OffsetDateTime]): Option[String] = {
    val newFrom = from.orElse(to).map(_.getYear)
    val newTo = to.orElse(from).map(_.getYear)

    (newFrom, newTo) match {
      case (Some(newFrom), Some(newTo)) => Some(s"$newFrom-$newTo")
      case _                            => None
    }
  }
}