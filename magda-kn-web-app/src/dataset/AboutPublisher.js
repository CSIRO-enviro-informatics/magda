import React, { Component } from "react";
import { Grid, Row, Col } from "react-bootstrap";
import { Link } from "react-router-dom";

import API from "../config";
import BubbleChart from "./BubbleChart";
import "./DataSet.css";

export default class AboutPublisher extends Component {
    constructor(props) {
        super(props);
        this.state = { pub_id: "", name: "", datasetNum: 0, keywords: [] };
    }

    componentWillMount(props) {
        this.setState({ pub_id: this.props.match.params.pub_id });
    }
    componentDidMount() {
        this.getData();
    }
    keywordClick = keyword => {
        // this.props.history.push("/search/" + keyword);
        console.log("Keyword <" + keyword + "> has been clicked");
    };
    getData() {
        if (this.state.pub_id !== "")
            fetch(
                API.dataSetOrgInfo +
                    this.state.pub_id +
                    "?aspect=organization-details&optionalAspect=source"
            )
                .then(response => {
                    if (response.status === 200) {
                        return response.json();
                    } else console.log("Get data error ");
                })
                .then(json => {
                    this.setState({ aspects: json.aspects, name: json.name });
                    this.getDatasetCountByPublisher(json.name);
                    this.getKeywords(json.name);
                })
                .catch(error => {
                    console.log("error on .catch", error);
                });
    }
    getKeywords(publisherName) {
        let query = {
            size: 0,
            query: {
                bool: {
                    must: [{ match: { "publisher.name": publisherName } }]
                }
            },
            aggs: {
                keywords_agg: {
                    terms: {
                        field: "keywords.raw",
                        size: 50
                    }
                }
            }
        };
        fetch(API.elasticSearch, {
            contentType: "application/json",
            method: "POST",
            body: JSON.stringify(query),
            dataType: "json"
        })
            .then(res => res.json())
            .then(json => {
                console.log(json);
                let keywords = json.aggregations.keywords_agg.buckets.map(
                    keys => {
                        return { label: keys.key, value: keys.doc_count };
                    }
                );
                this.setState({ keywords: keywords });
            })
            .catch(error => console.log(error));
    }
    getDatasetCountByPublisher(publisher) {
        fetch(
            API.search +
                "datasets?query=" +
                "*&publisher=" +
                publisher +
                "&start=0&limit=0"
        )
            .then(response => {
                if (response.status === 200) {
                    return response.json();
                } else console.log("Get data error ");
            })
            .then(json => {
                this.setState({ datasetNum: json.hitCount });
            })
            .catch(error => {
                console.log("error on .catch", error);
            });
    }

    render() {
        let data = [
            { _id: 1, value: 5, sentiment: "#000", selected: "true" },
            { _id: 1, value: 5, sentiment: "#000", selected: "true" },
            { _id: 1, value: 5, sentiment: "#000", selected: "true" }
        ];
        return (
            <Grid bsClass="padding-top">
                <Row>
                    <h2>About {this.state.name}</h2>
                    <hr />
                </Row>
                <Row>
                    <Col xs={3}>
                        <img
                            className="col-xs-12 img"
                            src={
                                this.state.aspects
                                    ? this.state.aspects["organization-details"]
                                          .imageUrl
                                        ? this.state.aspects[
                                              "organization-details"
                                          ].imageUrl
                                        : "../img/emptyImg.png"
                                    : ""
                            }
                            alt="No logo avilable"
                        />
                    </Col>
                    <Col xs={8}>
                        <ul className="list-group">
                            <li className="list-group-item">
                                ID: <code> {this.state.pub_id} </code>
                            </li>
                            <li className="list-group-item">
                                dataset:{" "}
                                <Link
                                    to={{
                                        pathname: `/publisher/dataset/${
                                            this.state.pub_id
                                        }`,
                                        params: { org_name: this.state.name }
                                    }}
                                >
                                    {" "}
                                    View all {this.state.datasetNum} datasets
                                </Link>{" "}
                            </li>
                            <li className="list-group-item">
                                Source
                                <pre>
                                    <ul>
                                        <li>
                                            Name:{" "}
                                            {this.state.aspects
                                                ? this.state.aspects.source.name
                                                : ""}{" "}
                                        </li>
                                        <li>
                                            type:{" "}
                                            {this.state.aspects
                                                ? this.state.aspects.source.type
                                                : ""}
                                        </li>
                                        <li>
                                            URL:{" "}
                                            <a
                                                href={
                                                    this.state.aspects
                                                        ? this.state.aspects
                                                              .source.url
                                                        : ""
                                                }
                                            >
                                                {" "}
                                                {this.state.aspects
                                                    ? this.state.aspects.source
                                                          .url
                                                    : ""}{" "}
                                            </a>
                                        </li>
                                    </ul>
                                </pre>
                            </li>
                            <li className="list-group-item">
                                Description
                                <pre>
                                    {this.state.aspects
                                        ? this.state.aspects[
                                              "organization-details"
                                          ].description
                                        : ""}
                                </pre>
                            </li>
                        </ul>
                    </Col>
                </Row>
                <Row>
                    <Col xs={3} />
                    <Col xs={8}>
                        {this.state.keywords.length === 0 ? (
                            ""
                        ) : (
                            <BubbleChart
                                graph={{
                                    zoom: 0.9,
                                    offsetX: -0.0,
                                    offsetY: -0.0
                                }}
                                showLegend={true} // optional value, pass false to disable the legend.
                                legendPercentage={20} // number that represent the % of with that legend going to use.
                                legendFont={{
                                    family: "Arial",
                                    size: 12,
                                    color: "#000",
                                    weight: "normal"
                                }}
                                valueFont={{
                                    family: "Arial",
                                    size: 12,
                                    color: "#fff",
                                    weight: "bold"
                                }}
                                labelFont={{
                                    family: "Arial",
                                    size: 16,
                                    color: "#fff",
                                    weight: "normal"
                                }}
                                data={this.state.keywords}
                                onclick={this.keywordClick}
                            />
                        )}
                    </Col>
                </Row>
                <br />
                <br />
                <br />
            </Grid>
        );
    }
}
