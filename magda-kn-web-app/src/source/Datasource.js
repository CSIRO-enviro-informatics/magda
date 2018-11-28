import React, { Component } from "react";
import { Grid, Row, ButtonToolbar } from "react-bootstrap";
import { Link } from "react-router-dom";

import API from "../config";
import "./Datasource.css";

export default class Datasource extends Component {
    constructor(props) {
        super(props);
        this.state = { datasource: new Map() };
        this.allRecords = [];
    }
    componentDidMount() {
        if (this.state.datasource.size === 0) this.getDataSource(0);
    }

    getDataSource(pageToken) {
        // console.log('load data ... ')
        fetch(API.dataSource + "&pageToken=" + pageToken)
            .then(response => {
                // console.log(response)
                if (response.status === 200) {
                    return response.json();
                } else console.log("Get data error ");
            })
            .then(json => {
                if (json.nextPageToken) {
                    this.allRecords = this.allRecords.concat(json.records);
                    this.getDataSource(json.nextPageToken);
                } else {
                    this.organizeDataSource(this.allRecords);
                }
            })
            .catch(error => {
                console.log("error on .catch", error);
            });
    }

    organizeDataSource(data) {
        //Source map id as key, souce object as value
        let sourceMap = new Map();
        let sourcePublisherMap = new Map();
        data.map(record => {
            if (!sourceMap.has(record.aspects.source.id))
                sourceMap.set(record.aspects.source.id, record.aspects.source);
            let publisherArray =
                sourcePublisherMap.get(record.aspects.source.id) || [];
            publisherArray.push(record);
            sourcePublisherMap.set(record.aspects.source.id, publisherArray);
            return null;
        });
        this.setState({
            datasource: sourceMap,
            sourcePublisherMap: sourcePublisherMap
        });
    }

    render() {
        if (this.state.datasource === undefined) return <p />;
        const keys = [...this.state.datasource.keys()].sort();
        const datasourceView = [];
        for (const key in keys) {
            const datasourceObject = this.state.datasource.get(keys[key]);
            const datasourceName = datasourceObject.name;
            // console.log(datasourceName)
            datasourceView.push(
                <div className="col-md-3" key={key}>
                    <div className="thumbnail">
                        <img
                            className=""
                            src={"/img/" + keys[key] + ".png"}
                            alt="logo"
                        />
                        <Link
                            to={{
                                pathname: `/datasource/${keys[key]}`,
                                params: {
                                    sourcePublisherMap: this.state
                                        .sourcePublisherMap,
                                    datasource: this.state.datasource
                                }
                            }}
                        >
                            <div className="overlay">
                                <div className="text">
                                    <p>{datasourceName}</p>
                                    <p>
                                        {
                                            this.state.sourcePublisherMap.get(
                                                keys[key]
                                            ).length
                                        }{" "}
                                        Publishers
                                    </p>
                                </div>
                            </div>
                        </Link>
                    </div>
                </div>
            );
        }
        return (
            <Grid bsClass="padding-top">
                <Row>
                    <h2>Data Sources</h2>
                    <hr />
                </Row>
                <Row>{datasourceView}</Row>
            </Grid>
        );
    }
}
