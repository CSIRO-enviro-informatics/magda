import React, { Component } from "react";
import { Link } from "react-router-dom";

export default class SearchResultView extends Component {
    render() {
        // console.log(this.props.result)
        if (this.props.result !== "" && this.props.result !== undefined) {
            return (
                <div>
                    {this.props.result.dataSets.map((item, key) => {
                        return (
                            <div className="search-res-item" key={key}>
                                <h3>
                                    {" "}
                                    {key + 1}.{" "}
                                    <Link
                                        to={
                                            "/dataset/" +
                                            encodeURIComponent(item.identifier)
                                        }
                                    >
                                        {" "}
                                        {item.title}{" "}
                                    </Link>
                                </h3>
                                <div className="search-res-row">
                                    <div>
                                        <cite>{item.landingPage}</cite>
                                    </div>
                                    <span className="search-res-text">
                                        {item.description
                                            ? item.description.substring(0, 200)
                                            : ""}
                                    </span>
                                    <div className="search-res-text">
                                        <b>Source:</b>
                                        {item.catalog}
                                    </div>
                                    <div className="search-res-text">
                                        <b>Score:</b>
                                        {item.quality}
                                    </div>
                                </div>
                                <hr />
                            </div>
                        );
                    })}
                </div>
            );
        } else {
            return <div />;
        }
    }
}
