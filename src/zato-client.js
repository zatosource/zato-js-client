/*
Copyright (C) 2018, Zato Source s.r.o. https://zato.io

Licensed under LGPLv3, see LICENSE.txt for terms and conditions.
*/

'use strict';

// ###############################################################################################################################

const axios = require('axios');
const base64 = require('js-base64').Base64;

// ###############################################################################################################################

class InvocationException {

// ###############################################################################################################################

  constructor(msg, response) {
    this.msg = msg;
    this.response = response;
  }

  toString() {
    return '<'+ this.msg + ' ' + JSON.stringify(this.response.data) + '>'
  }
}

// ###############################################################################################################################

class RESTClient {

// ###############################################################################################################################

  constructor(address, path, username, password, config=null) {
    this.address = address;
    this.path = path;
    this.username = username;
    this.password = password;
    this._impl = axios.create(config || {
      'baseURL': this.address,
      'url': this.path,
      'auth': {
        'username': this.username,
        'password': this.password,
      }
    })
  }

  invoke(service_name, data, on_success, on_error, finally_) {

    // Either apply user-specific callbacks or the default ones
    // but note that there is no default callback for the finally block.
    const _on_success = on_success || this._on_success;
    const _on_error = on_error || this._on_error;

    const json_string = JSON.stringify(data);
    const payload = base64.encode(json_string);

    const request = {
      'name': service_name,
      'data_format': 'json',
      'payload': payload,
    }

    this._impl.post(this.path, request).
      then(_on_success).
      catch(_on_error).
      then(finally_);
  }

  _on_success(http_response) {

    // Do we have HTTP 200 OK?
    if(http_response.status != 200) {
      throw new InvocationException('HTTP response.status != 200', http_response);
    }

    // On HTTP 200 OK we should have a JSON response
    const data = http_response.data;

    // Do we have an OK from Zato?
    if(data.zato_env.result != 'ZATO_OK') {
      throw new InvocationException('Zato result != ZATO_OK', http_response);
    }

    // All checks done, we can now deserialize the actual response
    const service_response = base64.decode(data.zato_service_invoke_response.response);

    console.log('Response received `'+ service_response + '`');
  }

  _on_error(e) {
    console.log('Caught an exception: `'+ e + '`');
  }

  static from_config(config) {
    const address = config.baseURL;
    const path = config.url;
    const username = config.auth.username;
    const password = config.auth.password;
    return new RESTClient(address, path, username, password, config);
  }

// ###############################################################################################################################

}

// ###############################################################################################################################

const address = 'http://localhost:11223';
const path = '/api';
const username = 'username1';
const password = 'password1';
const service_name = 'zato.ping';

//const client = new RESTClient(address, path, username, password);

const config = {
  'baseURL': address,
  'url': path,
  'auth': {
    'username': username,
    'password': password,
  }
}

const client = RESTClient.from_config(config);

const request = {
  'aaa': 'AAA',
  'bbb': 111
}

client.invoke(service_name, request)

// ###############################################################################################################################
