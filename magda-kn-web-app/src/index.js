import React from "react";
import ReactDom from "react-dom";
import { BrowserRouter } from "react-router-dom";
import App from "./App";

// Internet Explorer 6-11
let isIE = /*@cc_on!@*/ false || !!document.documentMode;

if (!isIE) {
    ReactDom.render(
        <BrowserRouter>
            <App />
        </BrowserRouter>,
        document.getElementById("root")
    );
} else {
    ReactDom.render(
        <div className="container ">
            <div className="row padding-top">
                <p>
                    Your IE browser (6-11) does not be supported, please try{" "}
                    <strong>Google Chrome</strong>,{" "}
                    <strong>Mozilla Firefox</strong>, or{" "}
                    <strong>Microsoft Edge</strong>.
                </p>
                <p>You can download these browsers from links as below:</p>
                <ul>
                    <li>
                        <a
                            href="https://www.google.com.au/chrome/"
                            target="_blank"
                            rel="noopener"
                        >
                            Google Chrome{" "}
                        </a>
                    </li>
                    <li>
                        <a
                            href="https://www.mozilla.org/en-US/firefox/new/"
                            target="_blank"
                            rel="noopener"
                        >
                            Mozilla Firefox{" "}
                        </a>
                    </li>
                    <li>
                        <a
                            href="https://www.microsoft.com/en-au/windows/microsoft-edge"
                            target="_blank"
                            rel="noopener"
                        >
                            Microsoft Edge
                        </a>
                    </li>
                </ul>
                <p>&nbsp;</p>
            </div>
        </div>,
        document.getElementById("root")
    );
}
