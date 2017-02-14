package au.csiro.data61.magda.registry

import scalikejdbc._
import spray.json._

import scala.util.Try
import scala.util.{Failure, Success}
import java.sql.SQLException

import gnieh.diffson._
import gnieh.diffson.sprayJson._

object RecordPersistence extends Protocols with DiffsonProtocol {
  def getAll(implicit session: DBSession): Iterable[RecordSummary] = {
    tuplesToSummaryRecords(sql"""select recordId, Records.name as recordName, aspectId
                                 from Records
                                 left outer join RecordAspects using (recordId)"""
      .map(recordSummaryRowToTuple)
      .list.apply())
      
  }

  def getAllWithAspects(implicit session: DBSession, aspectIds: Iterable[String]): Iterable[Record] = {
    tuplesToRecords(sql"""select recordId, Records.name as recordName, aspectId, Aspects.name as aspectName, data
                          from Records
                          left outer join RecordAspects using (recordId)
                          left outer join Aspects using (aspectId)
                          where aspectId in ($aspectIds)"""
      .map(recordRowWithDataToTuple)
      .list.apply())
  }
  
  def getById(implicit session: DBSession, id: String): Option[Record] = {
    tuplesToRecords(sql"""select recordId, Records.name as recordName, aspectId, Aspects.name as aspectName, data
                          from Records
                          left outer join RecordAspects using (recordId)
                          left outer join Aspects using (aspectId)
                          where recordId=$id"""
      .map(recordRowWithDataToTuple)
      .list.apply()).headOption
  }
  
  def getRecordAspectById(implicit session: DBSession, recordId: String, aspectId: String): Option[JsObject] = {
    sql"""select RecordAspects.aspectId as aspectId, name as aspectName, data from RecordAspects
          inner join Aspects using (aspectId)
          where RecordAspects.recordId=$recordId
          and RecordAspects.aspectId=$aspectId"""
      .map(rowToAspect)
      .single.apply()
  }
  
  def putRecordById(implicit session: DBSession, id: String, newRecord: Record): Try[Record] = {
    for {
      _ <- if (id == newRecord.id) Success(newRecord) else Failure(new RuntimeException("The provided ID does not match the record's ID."))
      oldRecord <- this.getById(session, id) match {
        case Some(record) => Success(record)
        case None => createRecord(session, newRecord)
      }
      recordPatch <- Try {
        // Diff the old record and the new one
        val oldRecordJson = oldRecord.toJson
        val newRecordJson = newRecord.toJson

        JsonDiff.diff(oldRecordJson, newRecordJson, false)
      }
      result <- patchRecordById(session, id, recordPatch)
    } yield result
  }

  def patchRecordById(implicit session: DBSession, id: String, recordPatch: JsonPatch): Try[Record] = {
    for {
      record <- this.getById(session, id) match {
        case Some(record) => Success(record)
        case None => Failure(new RuntimeException("No record exists with that ID."))
      }
      recordOnlyPatch <- Success(recordPatch.filter(op => op.path match {
        case "aspects" / _ => false
        case _ => true
      }))
      eventId <- Try {
        if (recordOnlyPatch.ops.length > 0) {
          val event = PatchRecordEvent(id, recordOnlyPatch).toJson.compactPrint
          sql"insert into Events (eventTypeId, userId, data) values (${PatchRecordEvent.Id}, 0, $event::json)".updateAndReturnGeneratedKey().apply()
        } else {
          0
        }
      }
      patchedRecord <- Try {
        val recordJson = record.toJson
        val patchedJson = recordOnlyPatch(recordJson)
        patchedJson.convertTo[Record]
      }
      _ <- if (id == patchedRecord.id) Success(patchedRecord) else Failure(new RuntimeException("The patch must not change the record's ID."))
      _ <- Try {
        if (recordOnlyPatch.ops.length > 0) {
          sql"""update Records set name = ${patchedRecord.name}, lastUpdate = $eventId where recordId = $id""".update.apply()
        } else {
          0
        }
      }
      aspectResults <- Try {
        recordPatch.ops.groupBy(op => op.path match {
          case "aspects" / (name / _) => Some(name)
          case _ => None
        }).filterKeys(!_.isEmpty).map({
          // Patch each aspect
          case (Some(aspectId), operations) => (aspectId, patchRecordAspectById(session, id, aspectId, JsonPatch(operations.map({
            // Make paths in operations relative to the aspect instead of the record
            case Add("aspects" / (name / rest), value) => Add(rest, value)
            case Remove("aspects" / (name / rest), old) => Remove(rest, old)
            case Replace("aspects" / (name / rest), value, old) => Replace(rest, value, old)
            case Move("aspects" / (sourceName / sourceRest), "aspects" / (destName / destRest)) => Move(sourceRest, destRest)
            case Copy("aspects" / (sourceName / sourceRest), "aspects" / (destName / destRest)) => Copy(sourceRest, destRest)
            case Test("aspects" / (name / rest), value) => Test(rest, value)
            case _ => throw new RuntimeException("The patch contains an unsupported operation for aspect " + aspectId)
          }))))
          case _ => throw new RuntimeException("Aspect ID is missing (this shouldn't be possible).")
        })
      }
      // Report the first failed aspect, if any
      _ <- aspectResults.find(_._2.isFailure) match {
        case Some((_, failure)) => failure
        case _ => Success(record)
      }
      // No failed aspects, so unwrap the aspects from the Success Trys.
      aspects <- Success(aspectResults.map(aspect => (aspect._1, aspect._2.get)))
    } yield Record(patchedRecord.id, patchedRecord.name, aspects)
  }

  def patchRecordAspectById(implicit session: DBSession, recordId: String, aspectId: String, aspectPatch: JsonPatch): Try[JsObject] = {
    for {
      aspect <- this.getRecordAspectById(session, recordId, aspectId) match {
        case Some(aspect) => Success(aspect)
        case None => Failure(new RuntimeException("No aspect exists on that record with that ID."))
      }
      eventId <- Try {
        if (aspectPatch.ops.length > 0) {
          val event = PatchRecordAspectEvent(recordId, aspectId, aspectPatch).toJson.compactPrint
          sql"insert into Events (eventTypeId, userId, data) values (${PatchRecordAspectEvent.Id}, 0, $event::json)".updateAndReturnGeneratedKey().apply()
        } else {
          0
        }
      }
      patchedAspect <- Try {
        aspectPatch(aspect).asJsObject
      }
      _ <- Try {
        if (aspectPatch.ops.length > 0) {
          val jsonString = patchedAspect.compactPrint
          sql"""insert into RecordAspects (recordId, aspectId, lastUpdate, data) values (${recordId}, ${aspectId}, $eventId, $jsonString::json)
               on conflict (recordId, aspectId) do update
               set lastUpdate = $eventId, data = $jsonString::json
               """.update.apply()
        } else {
          0
        }
      }
    } yield patchedAspect
  }

  def putRecordAspectById(implicit session: DBSession, recordId: String, aspectId: String, newAspect: JsObject): Try[JsObject] = {
    for {
      oldAspect <- this.getRecordAspectById(session, recordId, aspectId) match {
        case Some(record) => Success(record)
        case None => createRecordAspect(session, recordId, aspectId, newAspect)
      }
      recordAspectPatch <- Try {
        // Diff the old record aspect and the new one
        val oldAspectJson = oldAspect.toJson
        val newAspectJson = newAspect.toJson

        JsonDiff.diff(oldAspectJson, newAspectJson, false)
      }
      result <- patchRecordAspectById(session, recordId, aspectId, recordAspectPatch)
    } yield result
  }

  def createRecord(implicit session: DBSession, record: Record): Try[Record] = {
    for {
      eventId <- Try {
          val eventJson = CreateRecordEvent(record.id, record.name).toJson.compactPrint
          sql"insert into Events (eventTypeId, userId, data) values (${CreateRecordEvent.Id}, 0, $eventJson::json)".updateAndReturnGeneratedKey.apply()
      }
      insertResult <- Try {
        sql"""insert into Records (recordId, name, lastUpdate) values (${record.id}, ${record.name}, $eventId)""".update.apply()
      } match {
        case Failure(e: SQLException) if e.getSQLState().substring(0, 2) == "23" =>
          Failure(new RuntimeException(s"Cannot create record '${record.id}' because a record with that ID already exists."))
        case anythingElse => anythingElse
      }
      hasAspectFailure <- record.aspects.map(aspect => createRecordAspect(session, record.id, aspect._1, aspect._2)).find(_.isFailure) match {
        case Some(Failure(e)) => Failure(e)
        case _ => Success(record)
      }
    } yield hasAspectFailure
  }

  def createRecordAspect(implicit session: DBSession, recordId: String, aspectId: String, aspect: JsObject): Try[JsObject] = {
    for {
      eventId <- Try {
        val eventJson = CreateRecordAspectEvent(recordId, aspectId, aspect).toJson.compactPrint
        sql"insert into Events (eventTypeId, userId, data) values (${CreateRecordAspectEvent.Id}, 0, $eventJson::json)".updateAndReturnGeneratedKey.apply()
      }
      insertResult <- Try {
        val jsonData = aspect.compactPrint
        sql"""insert into RecordAspects (recordId, aspectId, lastUpdate, data) values ($recordId, ${aspectId}, $eventId, $jsonData::json)""".update.apply()
        aspect
      } match {
        case Failure(e: SQLException) if e.getSQLState().substring(0, 2) == "23" =>
          Failure(new RuntimeException(s"Cannot create aspect '${aspectId}' for record '${recordId}' because the record or aspect does not exist, or because data already exists for that combination of record and aspect."))
        case anythingElse => anythingElse
      }
    } yield insertResult
  }

  private def recordSummaryRowToTuple(rs: WrappedResultSet) = (rs.string("recordId"), rs.string("recordName"), rs.string("aspectId"))
  private def recordRowWithDataToTuple(rs: WrappedResultSet) = (rs.string("recordId"), rs.string("recordName"), rs.string("aspectId"), rs.string("aspectName"), rs.stringOpt("data"))

  private def tuplesToSummaryRecords(tuples: List[(String, String, String)]): Iterable[RecordSummary] = {
    tuples.groupBy({ case (recordId, recordName, _) => (recordId, recordName) })
      .map {
        case ((recordId, recordName), value) =>
          RecordSummary(
            id = recordId,
            name = recordName,
            aspects = value.filter({ case (_, _, aspectId) => aspectId != null })
              .map({ case (_, _, aspectId) => aspectId }))
      }
  }

  private def tuplesToRecords(tuples: List[(String, String, String, String, Option[String])]): Iterable[Record] = {
    tuples.groupBy({ case (recordId, recordName, _, _, _) => (recordId, recordName) })
          .map {
            case ((recordId, recordName), value) =>
              Record(
                id = recordId,
                name = recordName,
                aspects = value.filter({ case (_, _, aspectId, _, data) => aspectId != null && data.isDefined })
                                .map({ case (_, _, aspectId, _, data) =>
                                  (aspectId, JsonParser(data.get).asJsObject)
                                }).toMap)
          }
  }
  
  private def rowToAspect(rs: WrappedResultSet): JsObject = {
    JsonParser(rs.string("data")).asJsObject
  }
}