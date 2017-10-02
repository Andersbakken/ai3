#!/usr/bin/env nodejs
/* global process, require */

const net = require('net');
const args = require('minimist')(process.argv.slice(1));

console.log(args);
