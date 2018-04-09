import addJwtSecretFromEnvVar from "@magda/typescript-common/dist/session/addJwtSecretFromEnvVar";
import AspectBuilder from "@magda/typescript-common/dist/AspectBuilder";
import GeoJSON from "./GeoJSON";
import createTransformer from "./createTransformer";
import JsonConnector from "@magda/typescript-common/dist/JsonConnector";
import Registry from "@magda/typescript-common/dist/registry/AuthorizedRegistryClient";
import * as fs from "fs";
import * as yargs from "yargs";

const argv = addJwtSecretFromEnvVar(
    yargs
        .config()
        .help()
        .option("id", {
            describe:
                "The ID of this connector. Datasets created by this connector will have an ID prefixed with this ID.",
            type: "string",
            demandOption: true
        })
        .option("name", {
            describe:
                "The name of this connector, to be displayed to users to indicate the source of datasets.",
            type: "string",
            demandOption: true
        })
        .option("sourceUrl", {
            describe: "The base URL of the GeoJSON file. It can be http://, https://, or file://",
            type: "string",
            demandOption: true
        })
        .option("ignoreHarvestSources", {
            describe:
                "An array of harvest sources to ignore.  Datasets from these harvest soures will not be added to the registry.",
            type: "array",
            default: []
        })
        .option("registryUrl", {
            describe:
                "The base URL of the registry to which to write data from CKAN.",
            type: "string",
            default: "http://localhost:6101/v0"
        })
        .option('interactive', {
            describe: 'Run the connector in an interactive mode with a REST API, instead of running a batch connection job.',
            type: 'boolean',
            default: false
        })
        .option('listenPort', {
            describe: 'The port on which to run the REST API when in interactive model.',
            type: 'number',
            default: 6113
        })
        .option('timeout', {
            describe: 'When in --interactive mode, the time in seconds to wait without servicing an REST API request before shutting down. If 0, there is no timeout and the process will never shut down.',
            type: 'number',
            default: 0
        })
        .option("jwtSecret", {
            describe: "The shared secret for intra-network communication",
            type: "string"
        })
        .option("userId", {
            describe:
                "The user id to use when making authenticated requests to the registry",
            type: "string",
            demand: true,
            default:
                process.env.USER_ID || process.env.npm_package_config_userId
        }).argv
);

const datasetAspectBuilders: AspectBuilder[] = [
    {
        aspectDefinition: {
            id: "geojson-feature",
            name: "GeoJSON Feature",
            jsonSchema: require("geojson-feature.schema.json")
        },
        builderFunctionString: fs.readFileSync(
            "aspect-templates/geojson-feature.js",
            "utf8"
        )
    },
    // {
    //     aspectDefinition: {
    //         id: "dcat-dataset-strings",
    //         name: "DCAT Dataset properties as strings",
    //         jsonSchema: require("@magda/registry-aspects/dcat-dataset-strings.schema.json")
    //     },
    //     builderFunctionString: fs.readFileSync(
    //         "aspect-templates/geojson-feature-strings.js",
    //         "utf8"
    //     )
    // },
    {
        aspectDefinition: {
            id: "source",
            name: "Source",
            jsonSchema: require("@magda/registry-aspects/source.schema.json")
        },
        builderFunctionString: fs.readFileSync(
            "aspect-templates/geojson-feature-source.js",
            "utf8"
        )
    },
    // {
    //     aspectDefinition: {
    //         id: "temporal-coverage",
    //         name: "Temporal Coverage",
    //         jsonSchema: require("@magda/registry-aspects/temporal-coverage.schema.json")
    //     },
    //     setupFunctionString: fs.readFileSync(
    //         "aspect-templates/temporal-coverage-setup.js",
    //         "utf8"
    //     ),
    //     builderFunctionString: fs.readFileSync(
    //         "aspect-templates/temporal-coverage.js",
    //         "utf8"
    //     )
    // }
];

const distributionAspectBuilders: AspectBuilder[] = [
    {
        aspectDefinition: {
            id: "geojson-distribution",
            name: "CKAN Resource",
            jsonSchema: require("geojson-distribution.schema.json")
        },
        builderFunctionString: fs.readFileSync(
            "aspect-templates/geojson-distribution.js",
            "utf8"
        )
    },
    // {
    //     aspectDefinition: {
    //         id: "dcat-distribution-strings",
    //         name: "DCAT Distribution properties as strings",
    //         jsonSchema: require("@magda/registry-aspects/dcat-distribution-strings.schema.json")
    //     },
    //     builderFunctionString: fs.readFileSync(
    //         "aspect-templates/dcat-distribution-strings.js",
    //         "utf8"
    //     )
    // },
    {
        aspectDefinition: {
            id: "source",
            name: "Source",
            jsonSchema: require("@magda/registry-aspects/source.schema.json")
        },
        builderFunctionString: fs.readFileSync(
            "aspect-templates/geojson-distribution-source.js",
            "utf8"
        )
    }
];

const organizationAspectBuilders: AspectBuilder[] = [
    // {
    //     aspectDefinition: {
    //         id: "source",
    //         name: "Source",
    //         jsonSchema: require("@magda/registry-aspects/source.schema.json")
    //     },
    //     builderFunctionString: fs.readFileSync(
    //         "aspect-templates/organization-source.js",
    //         "utf8"
    //     )
    // },
    // {
    //     aspectDefinition: {
    //         id: "organization-details",
    //         name: "Organization",
    //         jsonSchema: require("@magda/registry-aspects/organization-details.schema.json")
    //     },
    //     builderFunctionString: fs.readFileSync(
    //         "aspect-templates/organization-details.js",
    //         "utf8"
    //     )
    // }
];

const gj = new GeoJSON({
    sourceUrl: argv.sourceUrl,
    id: argv.id,
    name: argv.name,
    ignoreHarvestSources: argv.ignoreHarvestSources,
});

const registry = new Registry({
    baseUrl: argv.registryUrl,
    jwtSecret: argv.jwtSecret,
    userId: argv.userId
});

const transformerOptions = {
    id: argv.id,
    name: argv.name,
    sourceUrl: argv.sourceUrl,
    ignoreHarvestSources: argv.ignoreHarvestSources,
    registryUrl: argv.registryUrl,
    datasetAspectBuilders,
    distributionAspectBuilders,
    organizationAspectBuilders
};

const transformer = createTransformer(transformerOptions);

const connector = new JsonConnector({
    source: gj,
    transformer: transformer,
    registry: registry,
});

if (!argv.interactive) {
    connector.run().then(result => {
        console.log(result.summarize());
    });
} else {
    connector.runInteractive({
        timeoutSeconds: argv.timeout,
        listenPort: argv.listenPort,
        transformerOptions: transformerOptions
    });
}
