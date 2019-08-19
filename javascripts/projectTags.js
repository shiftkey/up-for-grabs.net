/* eslint global-require: "off" */
/* eslint block-scoped-var: "off" */

// @ts-nocheck

// required for loading into a NodeJS context
if (typeof define !== 'function') {
    var define = require('amdefine')(module);
  }


define(['underscore'], function(_) {
    return {}
})