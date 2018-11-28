import React, { Component } from "react";
import { Grid, Row } from "react-bootstrap";

import API from "../config";
import PublisherViews from "../dataset/PublisherViews";
import "./Datasource.css";

export default class DatasourceForOrg extends Component {
    constructor(props) {
        super(props);
        this.state = {
            sourcePublisherMap: this.props.location.params
                ? this.props.location.params.sourcePublisherMap
                : "",
            datasource: this.props.location.params
                ? this.props.location.params.datasource
                : ""
        };
        this.allRecords = [];
    }

    componentDidMount() {
        // console.log(this.props)
        if (this.state.sourcePublisherMap === "") {
            this.getDataSource(0);
        }
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
        if (this.state.datasetForOrg === "") return <p />;

        return (
            <Grid bsClass="padding-top">
                <Row>
                    <h2>
                        {" "}
                        Organizations of datasource{" "}
                        {this.state.datasource
                            ? this.state.datasource.get(
                                  this.props.match.params.source_id
                              ).name
                            : ""}{" "}
                    </h2>
                    <hr />
                </Row>
                <Row>
                    {this.state.sourcePublisherMap ? (
                        <PublisherViews
                            publisherMap={this.state.sourcePublisherMap}
                            datasource={this.state.datasource}
                            default={this.props.match.params.source_id}
                        />
                    ) : (
                        undefined
                    )}
                </Row>
            </Grid>
        );
    }
}
