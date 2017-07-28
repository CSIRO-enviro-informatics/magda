import {
  Record,
  WebHook,
  WebHookConfig,
  AspectDefinition
} from "@magda/typescript-common/dist/generated/registry/api";
import Registry, { RecordsPage } from "@magda/typescript-common/dist/Registry";
import unionToThrowable from "@magda/typescript-common/dist/util/union-to-throwable";
import AsyncPage, {
  forEachAsync
} from "@magda/typescript-common/dist/AsyncPage";
import * as express from "express";

export type SleutherOptions = {
  registry: Registry;
  host: string;
  defaultPort: number;
  id: string;
  aspects: string[];
  optionalAspects: string[];
  writeAspectDefs: AspectDefinition[];
  onRecordFound: (record: Record) => Promise<void>;
  express: () => express.Express;
};

export default async function sleuther(
  options: SleutherOptions
): Promise<void> {
  setupWebhookEndpoint(options);

  await putAspectDefs(options);
  await registerWebhook(options);
  await crawlExistingRecords(options);
}

async function putAspectDefs(options: SleutherOptions) {
  const aspectDefsToAdd = options.writeAspectDefs;
  console.info(`Adding aspect defs ${aspectDefsToAdd.map(def => def.name)}`);

  const addPromises = aspectDefsToAdd.map(aspectDef =>
    options.registry.putAspectDefinition(aspectDef)
  );

  return Promise.all(addPromises).then(failIfErrors).then(result => {
    console.info("Successfully added aspect defs");
    return result;
  });
}

function failIfErrors<T>(results: Array<T | Error>) {
  const failed = results.filter((result: T | Error) => result instanceof Error);

  if (failed.length > 0) {
    throw failed[0];
  } else {
    return results;
  }
}

function setupWebhookEndpoint(options: SleutherOptions) {
  const server = options.express();

  server.get(
    "/hook",
    (request: express.Request, response: express.Response) => {
      const payload = request.body();
      const promises: Promise<void>[] = payload.records.map((record: Record) =>
        options.onRecordFound(record)
      );

      Promise.all(promises)
        .then(results => {
          response.status(201).send("Received");
        })
        .catch(e => {
          console.error(e);
          response.status(500).send("Error");
        });
    }
  );

  console.info(`Listening at ${getHookUrl(options)}`);
  server.listen(getPort(options));
}

function getHookUrl(options: SleutherOptions) {
  return `http://${options.host}:${getPort(options)}/hook`;
}

function getPort(options: SleutherOptions) {
  return process.env.NODE_PORT || options.defaultPort;
}

async function registerWebhook(options: SleutherOptions) {
  console.info("Registering webhook");
  await registerNewWebhook(options);
}

async function registerNewWebhook(options: SleutherOptions) {
  const webHookConfig: WebHookConfig = {
    aspects: options.aspects,
    optionalAspects: options.optionalAspects,
    includeEvents: false,
    includeRecords: true,
    includeAspectDefinitions: false,
    dereference: true
  };

  const newWebHook: WebHook = {
    id: options.id,
    userId: 0, // TODO: When this matters
    name: options.id,
    active: true,
    url: getHookUrl(options),
    eventTypes: [
      "CreateRecord",
      "CreateAspectDefinition",
      "CreateRecordAspect",
      "PatchRecord",
      "PatchAspectDefinition",
      "PatchRecordAspect"
    ],
    config: webHookConfig,
    lastEvent: null
  };

  options.registry.putHook(newWebHook);
}

async function crawlExistingRecords(options: SleutherOptions) {
  const registryPage = AsyncPage.create<RecordsPage<Record>>(previous => {
    if (previous && previous.records.length === 0) {
      console.info("No more records left");
      // Last page was an empty page, no more records left
      return undefined;
    } else {
      console.info(
        "Crawling after token " +
          (previous && previous.nextPageToken
            ? previous.nextPageToken
            : "<first page>")
      );
      return options.registry
        .getRecords<Record>(
          options.aspects,
          options.optionalAspects,
          previous && previous.nextPageToken,
          true
        )
        .then(unionToThrowable)
        .then(page => {
          console.info(`Crawled ${page.records.length} records`);
          return page;
        });
    }
  }).map((page: RecordsPage<Record>) => page.records);

  await forEachAsync(registryPage, 20, (record: Record) =>
    options.onRecordFound(record)
  );
}
