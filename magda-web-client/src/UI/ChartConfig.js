import React, { Component } from 'react';
import PropTypes from 'prop-types';
import './ChartConfig.css'
import Option from 'muicss/lib/react/option';
import Select from 'muicss/lib/react/select';
import Input from 'muicss/lib/react/input';

const VEGAMARK = ['area', 'bar', 'circle', 'line', 'point', 'rect', 'square', 'text', 'tick'];
const DATATYPE = ['quantitative', 'temporal', 'ordinal', 'nominal'];

export default class ChartConfig extends Component {
  renderTypeSelect(options,id, label){
      return (<Select name="input" label={label} defaultValue={this.props[id]}>
          {options.map(o=><Option key={o} value={o} label={o}/>)}
      </Select>)
  }

  render(){
    return (<div className='chart-config'>
              <div className='chart-type'>{this.renderTypeSelect(VEGAMARK, 'chartType', 'Chart type')}</div>
              <div className='chart-title'><Input label="Chart title" /></div>
              <div className='y-axis'><Input label="Y axis" /></div>
              <div className='x-axis'><Input label="X axis" /></div>
              <div className='linear'>{this.renderTypeSelect(DATATYPE, 'yScale', 'Chart scale')}</div>
            </div>)
  }
}

ChartConfig.propTypes = {

};
