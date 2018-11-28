// const fallbackApiHost = "https://kn-v2-dev.oznome.csiro.au/";
// const fallbackApiHost = 'http://adb009eba34b.k8s-dev.oznome.csiro.au/'
// const fallbackApiHost = "http://kn-v2-staging.k8s-dev.oznome.csiro.au/"
const fallbackApiHost = "http://staging.knowledgenet.co/";
// const fallbackApiHost = "http://knowledgenet.co/";
const serverConfig = window.magda_server_config || "";
const registryApiUrl =
    serverConfig.registryApiBaseUrl || fallbackApiHost + "api/v0/registry/";
const authApiUrl =
    serverConfig.authApiBaseUrl || fallbackApiHost + "api/v0/auth/";
const API = {
    baseUri: serverConfig || fallbackApiHost,
    authApiUrl: serverConfig.authApiBaseUrl || fallbackApiHost + "api/v0/auth/",
    datasetCount:
        registryApiUrl + "records?limit=0&aspect=dcat-dataset-strings",
    organisationsCount:
        registryApiUrl + "records?limit=0&aspect=organization-details",
    search: serverConfig.searchApiBaseUrl || fallbackApiHost + "api/v0/search/",
    dataSetDetail: registryApiUrl + "records/",
    dataSetDetail_allAspects:
        "?aspect=dcat-dataset-strings&optionalAspect=dcat-distribution-strings&optionalAspect=dataset-distributions&optionalAspect=temporal-coverage&dereference=true&optionalAspect=dataset-publisher&optionalAspect=source&optionalAspect=link-status&optionalAspect=dataset-quality-rating&optionalAspect=dataset-linked-data-rating",
    dataSetOrg:
        registryApiUrl +
        "records?aspect=organization-details&optionalAspect=source&limit=20000",
    dataSetOrgInfo: registryApiUrl + "records/",
    dataSourceCount:
        registryApiUrl +
        "records?limit=0&aspect=organization-details&optionalAspect=source",
    dataSource:
        registryApiUrl +
        "records?aspect=organization-details&optionalAspect=source&limit=20000",
    elasticSearch: "https://es.knowledgenet.co/datasets32/_search"
};

export default API;
