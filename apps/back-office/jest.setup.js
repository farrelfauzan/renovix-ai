/* eslint-disable */
// jsdom has no TextEncoder, which `qrcode` uses to encode the text (browsers and Node have it).
const { TextEncoder } = require('node:util');
global.TextEncoder = global.TextEncoder ?? TextEncoder;
