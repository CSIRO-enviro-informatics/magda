import { getCommonFormat } from "../formats";
import MeasureResult from "./MeasureResult";

/*
* Tries to determine the format by parsing the downloadURL string and looking at the extension
* TODO not finished
*/
export default function getMeasureResults(
    relatedDistribution: any,
    synonymObject: any
): MeasureResult {
    const { downloadURL } = relatedDistribution.aspects[
        "dcat-distribution-strings"
    ];

    if (downloadURL === null || downloadURL === "") {
        return null;
    }

    let downloadURLString: string = downloadURL;

    const urlRegexes: Array<Array<string>> = [
        [".*\\.geojson$", "GEOJSON"],
        [".*?.*service=wms.*", "WMS"],
        [".*?.*service=wfs.*", "WFS"],
        [".*\\.(shp|shz|dbf)(\\.zip)?$", "SHP"],
        [".*\\.(pdf)(\\.zip)?$", "PDF"],
        [".*\\.(json)(\\.zip)?$", "JSON"],
        [".*\\.(xml)(\\.zip)?$", "XML"],
        [".*\\.(doc)(\\.zip)?$", "DOC"],
        [".*\\.(docs)(\\.zip)?$", "DOCS"],
        [".*\\.(xlsx)(\\.zip)?$", "XLSX"],
        [".*\\.(xls)(\\.zip)?$", "XLS"],
        [".*\\.(tif)(\\.zip)?$", "TIFF"],
        [".*\\.(zip)$", "ZIP"],
        [".*\\.(html|xhtml|php|asp|aspx|jsp|htm)(\\?.*)?", "HTML"],
        [".*\\/$", "HTML"]
    ];

    let formatFromURL: Array<string> = urlRegexes.find(regexCombo => {
        return downloadURLString.match(regexCombo[0]) ? true : false;
    });

    if (formatFromURL && formatFromURL.length > 0) {
        return {
            formats: [
                {
                    format: getCommonFormat(formatFromURL[1], synonymObject),
                    correctConfidenceLevel: 100
                }
            ],
            distribution: relatedDistribution
        };
    } else {
        return null;
    }
}
