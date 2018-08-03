import React, { Component } from "react";
import { Grid, Row, Col, Button } from "react-bootstrap";
import { OrderedSet } from "immutable";
import Slider from "rc-slider";

import SearchResultView from "../search/SearchResultView";
import Checkbox from "../search/Checkbox";
import Pagination from "../dataset/Pagination";
import "./DataSet.css";
import API from "../config";
import BubbleChart from "./BubbleChart";

import "rc-slider/assets/index.css";
import "rc-tooltip/assets/bootstrap.css";

const createSliderWithTooltip = Slider.createSliderWithTooltip;
// const Range = createSliderWithTooltip(Slider.Range)

export default class DataSetListForOrg extends Component {
    constructor(props) {
        super(props);
        this.min = 0;
        this.max = 40000;
        this.state = {
            result: "",
            total: 0,
            perPage: 10,
            currentPage: 0,
            publisher: this.props.location.params
                ? this.props.location.params.org_name
                : "",
            facetFormatCollapse: false,
            searchText: "",
            min: this.min,
            max: this.max,
            keywords: []
        };
        this.searchTextChange = this.searchTextChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }

    componentWillMount() {
        this.selectedFormatCheckboxes = new Set();
        this.dateRange = new OrderedSet();
    }
    updateCurrentPage = page => {
        this.setState({ currentPage: page });
        let query = this.preparSearchText();
        this.getData(query, page * this.state.perPage, 10);
    };
    toggleFormatCollapse = e => {
        e.preventDefault();
        this.setState({ facetFormatCollapse: !this.state.facetFormatCollapse });
    };
    componentDidMount() {
        // console.log(this.state.publisher)
        if (this.state.publisher === "") {
            this.getPublisherById(this.props.match.params.pub_id, 0, 10);
        } else
            this.getData(
                this.state.searchText + "&publisher=" + this.state.publisher,
                0,
                10
            );
    }

    getPublisherById(id, start, limit) {
        fetch(API.dataSetOrgInfo + id)
            .then(response => {
                if (response.status === 200) {
                    return response.json();
                } else console.log("Get data error ");
            })
            .then(json => {
                console.log(json);
                this.setState({ publisher: json.name });
                this.getData(
                    this.state.searchText + "&publisher=" + json.name,
                    start,
                    limit
                );
            })
            .catch(error => {
                console.log("error on .catch", error);
            });
    }
    preparSearchText() {
        let byPublisher =
            "&publisher=" + encodeURIComponent(this.state.publisher);
        let byFormat = "";
        let fromto = "";

        for (const checkbox of this.selectedFormatCheckboxes) {
            byFormat = byFormat + "&format=" + encodeURIComponent(checkbox);
        }
        if (this.state.min !== 0) {
            fromto = fromto + "&dateFrom=" + this.min;
        }
        if (this.state.max !== 40000) {
            fromto = fromto + "&dateTo=" + this.max;
        }
        return this.state.searchText + byPublisher + byFormat + fromto;
    }
    keywordClick = keyword => {
        // this.props.history.push("/search/" + keyword);
        console.log("Keyword <" + keyword + "> has been clicked");
    };

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

    getData(query, start, limit) {
        //+ '&start='+ start +'&limit='+ limit +'&facetSize=99999'
        this.getKeywords(this.state.publisher);
        fetch(
            API.search +
                "datasets?query=" +
                query +
                "&start=" +
                start +
                "&limit=" +
                limit +
                "&facetSize=99999"
        )
            .then(response => {
                // console.log(response)
                if (response.status === 200) {
                    return response.json();
                } else console.log("Get data error ");
            })
            .then(json => {
                // console.log(json)
                this.setState({ result: json, total: json.hitCount });
                let newFormats = new Set();
                for (let ele of json.facets[1].options) {
                    if (this.selectedFormatCheckboxes.has(ele.value)) {
                        newFormats.add(ele.value);
                    }
                }
                this.selectedFormatCheckboxes = new Set([...newFormats.keys()]);
                // console.log(this.selectedFormatCheckboxes)
                // Calculate date range
                // const year = json.facets[1].options
                // for(let key in year){
                //     this.dateRange = this.dateRange.add(year[key].lowerBound)
                //     this.dateRange = this.dateRange.add(year[key].upperBound)
                // }
                // this.setState({
                //     min: this.dateRange.min(),
                //     max: this.dateRange.max()
                // })
            })
            .catch(error => {
                console.log("error on .catch", error);
            });
    }

    toggleFormatCheckbox = label => {
        if (this.selectedFormatCheckboxes.has(label)) {
            this.selectedFormatCheckboxes.delete(label);
        } else {
            this.selectedFormatCheckboxes.add(label);
        }
        console.log(this.selectedFormatCheckboxes);
    };

    createFormatCheckbox(label, hitCount) {
        return (
            <Checkbox
                label={label}
                handleCheckboxChange={this.toggleFormatCheckbox}
                key={label}
                initChecked={this.selectedFormatCheckboxes}
                hitCount={hitCount}
            />
        );
    }
    filterButtonSubmit = () => {
        let query = this.preparSearchText();
        this.getData(query, 0, 10);
    };

    onAfterChange = value => {
        // console.log(value)
        this.min = value[0];
        this.max = value[1];
    };

    searchTextChange(e) {
        this.setState({ searchText: e.target.value });
    }

    handleSubmit(e) {
        e.preventDefault();
        // let preparedText = this.preparSearchText(this.state.publisher)
        let query = this.preparSearchText();
        this.getData(query, 0, 10);
    }

    render() {
        // console.log(this.state.result)
        if (this.state.result !== "")
            return (
                <div className="padding-top">
                    <Grid>
                        <Row>
                            <h3>
                                Search datasets of{" "}
                                <i> {this.state.publisher}</i>{" "}
                            </h3>
                            <br />
                        </Row>
                        <Row>
                            <Col md={3}>
                                <img
                                    className="img-responsive img-rounded"
                                    src="/img/knowledge_graph1.png"
                                    width="200px"
                                    alt=""
                                />
                            </Col>
                            <Col md={9}>
                                {/* <form role="search" onSubmit={this.handleSubmit}> */}
                                <div className="search-bar input-group">
                                    <input
                                        type="text"
                                        className="search-query form-control"
                                        placeholder={
                                            "Search datasets of " +
                                            this.state.publisher
                                        }
                                        name="q"
                                        value={this.state.searchText}
                                        onChange={this.searchTextChange}
                                    />
                                    <span className="input-group-btn">
                                        <button
                                            className="btn btn-danger"
                                            type="submit"
                                            onClick={this.handleSubmit}
                                        >
                                            <span className=" glyphicon glyphicon-search" />
                                        </button>
                                    </span>
                                </div>
                                {/* </form> */}
                            </Col>
                        </Row>
                        <Row>
                            <br />
                            <i> {this.state.result.hitCount} datasets found</i>
                            <hr />
                        </Row>
                        <Row>
                            <Col md={8}>
                                <SearchResultView result={this.state.result} />
                                <Pagination
                                    perPage={this.state.perPage}
                                    total={this.state.total}
                                    updateCurrentPage={this.updateCurrentPage}
                                />
                                <br />
                                <br />
                            </Col>
                            <Col md={4}>
                                <div className="right-filter">
                                    <Row>
                                        <h4 className="col-xs-8">
                                            <a
                                                href="#"
                                                onClick={
                                                    this.toggleFormatCollapse
                                                }
                                            >
                                                {this.state.result.facets[1].id}
                                                &nbsp;&nbsp;
                                                {this.state
                                                    .facetFormatCollapse ? (
                                                    <i className="fa fa-angle-double-down" />
                                                ) : (
                                                    <i className="fa fa-angle-double-up" />
                                                )}
                                            </a>
                                        </h4>
                                        <span className="col-xs-4">
                                            <Button
                                                bsStyle="info"
                                                className="pull-right"
                                                onClick={
                                                    this.filterButtonSubmit
                                                }
                                            >
                                                {" "}
                                                Refine Result{" "}
                                            </Button>
                                        </span>
                                    </Row>
                                    <hr />
                                    <ul className="cust-list">
                                        {this.state.facetFormatCollapse
                                            ? this.state.result.facets[1].options.map(
                                                  (value, key) => {
                                                      return (
                                                          <li
                                                              className="checkbox"
                                                              key={key}
                                                          >
                                                              {this.createFormatCheckbox(
                                                                  value.value,
                                                                  value.hitCount
                                                              )}
                                                          </li>
                                                      );
                                                  }
                                              )
                                            : this.state.result.facets[1].options
                                                  .slice(0, 15)
                                                  .map((value, key) => {
                                                      return (
                                                          <li
                                                              className="checkbox"
                                                              key={key}
                                                          >
                                                              {this.createFormatCheckbox(
                                                                  value.value,
                                                                  value.hitCount
                                                              )}
                                                          </li>
                                                      );
                                                  })}

                                        {/* {this.state.result.facets[1].options.map((value, key) => {
                                return (<li className="checkbox"  key={key}> 
                                            {this.createFormatCheckbox(value.value, value.hitCount)}
                                        </li>)
                            })} */}
                                    </ul>
                                    <br />

                                    {/* <h4>Date Range</h4>
                        <div className="slider">
                        <i>The Data Range is retrieved from datasets</i>
                                <Range step={1} 
                                    defaultValue={[this.min, this.max]} 
                                    min={this.state.min} 
                                    max={this.state.max}
                                    onAfterChange={this.onAfterChange}
                                    dots={false}
                                    tipFormatter={value => `${value}`}
                                    allowCross={false}  />
                                <i>{this.state.min}</i><i className="pull-right">{this.state.max} </i>
                        </div> */}
                                    <hr />
                                    <Button
                                        bsStyle="info"
                                        className="pull-right"
                                        onClick={this.filterButtonSubmit}
                                    >
                                        {" "}
                                        Refine Result{" "}
                                    </Button>
                                </div>
                                <br />
                                <br />
                                <br />
                                <h4>Keywords for {this.state.publisher}</h4>
                                <hr />
                                {this.state.keywords.length === 0 ? (
                                    ""
                                ) : (
                                    <BubbleChart
                                        graph={{
                                            zoom: 0.9,
                                            offsetX: -0.0,
                                            offsetY: -0.0
                                        }}
                                        width={400}
                                        height={400}
                                        showLegend={false} // optional value, pass false to disable the legend.
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
                    </Grid>
                </div>
            );
        return <div />;
    }
}
