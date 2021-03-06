/*
Copyright (C) 2019, Zato Source s.r.o. https://zato.io

Licensed under LGPLv3, see LICENSE.txt for terms and conditions.
*/

/* **************************************************************************************************************************** */

// Require the WebSocket module under NodeJS
if(typeof process === 'object') {
    var WebSocket = require('ws')
}

/* **************************************************************************************************************************** */

LogLevel = {};
LogLevel.Error = 25;
LogLevel.Info  = 50;

/* **************************************************************************************************************************** */

/*
    A Zato WebSocket client which knows how to:

    * Establish long-running connections
    * Invoke services
    * Subscribe to pub/sub messages
    * Unsubscribe from pub/sub
    * Auto-reconnect if connections are closed by server
*/
class ZatoWSXClient {

/* **************************************************************************************************************************** */

constructor() {

      // Client ID -> a random string
    this.client_id = null;

    // Client name -> human-readable
    this.client_name = null;

    // WSX address to connect to
    this.address = null;

    // Username to log in with
    this.username = null;

    // Password to log in with
    this.secret = null;

    // Zato WSX token that we will be using once logged in
    this.invalid_token = '<invalid>';
    this.token = this.invalid_token;

    // The underlying WebSocket object
    this.impl = null;

    // A dictionary of msg_id objects to which we expect a response
    this.response_map = {};

    // How many milliseconds to wait for a response from Zato by default
    this.default_wait_time = 500;

    // A callback to invoke after the connection is established
    this.when_ready = null;

    // A callback to invoke after each message from Zato received
    this.on_message_received = null;

    // Maps subscription keys to topics
    this.topic_to_sub_key = {};

    // Maps topic names to subscription keys
    this.sub_key_to_topic = {};

    // At what verbosity to log;
    this.log_level = LogLevel.Error;

    // Are we already connected to Zato?
    this._is_connected = false;
  }

/* **************************************************************************************************************************** */

connect() {
    console.log('Connecting to '+ this.address);

    // Establish a new connection
    this.impl = new WebSocket(this.address);

    // Assign a callback that will obtain a session token
    this.impl.onopen = this.on_wsx_open.bind(this);

    // A callback invoked for each message received from the server
    this.impl.onmessage = this.on_wsx_message.bind(this);

    // A callback invoked after server closes the underlying connection
    this.impl.onclose = this.on_wsx_close.bind(this);
  }

/* **************************************************************************************************************************** */

get_disconnect_reason() {
    return `Client disconnecting id:'${this.client_id}' name:'${this.client_name}'`;
  }

/* **************************************************************************************************************************** */

disconnect() {
    this.impl.close(1000, this.get_disconnect_reason());
    console.log('Disconnected from '+ this.address);
  }

/* **************************************************************************************************************************** */

on_wsx_open(e) {
    console.log(`>> Connected to '${this.address}'`)

    // Set a flag signalling that we are connected now
    this._is_connected = true;

    // Request a session token now that we have connected
    const msg_id = this.new_message_id();
    const msg = this.get_create_session_message(msg_id);

    // A callback to invoke after we have a session established with Zato
    function on_session_created() {
        const msg = this.response_map[msg_id];
        console.log(`>> Received session token '${msg.data.token}' for client '${this.client_name}' (${this.client_id})`);
        this.token = msg.data.token;
        this.when_ready(this);
    }

    // Request a session token ..
    this.send(msg_id, msg);

    // .. and wait for it.
    this._wait_for_response(msg_id, on_session_created);
  }

/* **************************************************************************************************************************** */

_check_is_connected() {
    return this._is_connected;
  }

/* **************************************************************************************************************************** */

_check_has_token() {
    return this.token != this.invalid_token;
  }

/* **************************************************************************************************************************** */

_check_has_response(msg_id) {
    return this.response_map[msg_id];
  }

/* **************************************************************************************************************************** */

_continue_to_wait(attempts, condition_func, callback_func, object_type) {
    console.log(`<< Waiting for '${object_type}' to '${this.address}', attempts left: ${attempts+1}`);
    setTimeout(this.wait_for_event.bind(this), 200, attempts, condition_func, callback_func, object_type);
  }

/* **************************************************************************************************************************** */

wait_for_event(attempts, condition_func, callback_func, object_type) {
    if(!condition_func()) {
        if(attempts < 0) {
          console.log(`Could not obtain ${object_type} to ${this.address}`);
      }
      else {
          this._continue_to_wait(attempts-1, condition_func, callback_func, object_type);
      }
    }
    else {
        if(callback_func) {
          callback_func.bind(this)();
      }
    }
  }

/* **************************************************************************************************************************** */

wait_until_ready(attempts) {
    this.wait_for_event(attempts, this._check_is_connected.bind(this), null, 'connection');
  }

/* **************************************************************************************************************************** */

_wait_for_token() {
    this.wait_for_event(100, this._check_has_token.bind(this), this.when_ready, 'token');
  }

/* **************************************************************************************************************************** */

_wait_for_response(msg_id, callback_func) {
    this.wait_for_event(100, this._check_has_response.bind(this, msg_id), callback_func, 'response');
  }

_wait_for_sub_key(msg_id, callback_func) {
    this.wait_for_event(100, this._check_has_response.bind(this, msg_id), callback_func, 'sub_key');
  }

/* **************************************************************************************************************************** */

get_base_message(msg_id) {
    let msg = {}
    msg.meta = {
        'id': msg_id,
        'timestamp': new Date().toISOString(),
    }
        return msg;
  }

/* **************************************************************************************************************************** */

get_create_session_message(msg_id) {

    // Base message to enrich with additional information
    let msg = this.get_base_message(msg_id);

    msg.meta.action = 'create-session';

    msg.meta.client_id = this.client_id;
    msg.meta.client_name = this.client_name;

    msg.meta.username = this.username;
    msg.meta.secret = this.secret;

    return JSON.stringify(msg);
  }

/* **************************************************************************************************************************** */

get_service_invoke_message(msg_id, service, request) {

    // Base message to enrich with additional information
    let msg = this.get_base_message(msg_id);

    msg.meta.action = 'invoke-service';
    msg.meta.token = this.token;
    msg.meta.id = msg_id;

    msg.data = {
        'service': service,
        'request': request
    }

    return JSON.stringify(msg);
  }

/* **************************************************************************************************************************** */

new_message_id() {
    return this.client_name + '.' + Math.random().toString(16);
  }

/* **************************************************************************************************************************** */

send(msg_id, msg) {

      // Add msg_id to the response map, signalling thus that we expect a response
    this.response_map[msg_id] = null;

    // Invoke Zato
    this.impl.send(msg);
  }

/* **************************************************************************************************************************** */

handle_response(msg_id) {
    const response = this.response_map[msg_id];

    if(this.log_level >= LogLevel.Info) {
        console.log(`>> Response to '${msg_id}' is ${JSON.stringify(response)}`);
    }

    this.on_message_received(this, response, msg_id);
  }

/* **************************************************************************************************************************** */

publish(topic, _data, _ctx) {
    const ctx = _ctx || {};
    const data = _data || '';
    const msg_id = ctx.msg_id || '111';//this.new_message_id();
    const has_gd = ctx.has_gd || false;
    const priority = ctx.priority || 5;
    const expiration = ctx.expiration || null;
    const mime_type = ctx.mime_type || 'text/plain';
    const correl_id = ctx.correl_id || null;
    const in_reply_to = ctx.in_reply_to || null;
    const ext_client_id = ctx.ext_client_id || null;
    const ext_pub_time = ctx.ext_pub_time || null;

    const request = {
      'topic_name':topic,
      'data':data,
      'msg_id':msg_id,
      'has_gd':has_gd,
      'priority':priority,
      'expiration':expiration,
      'mime_type':mime_type,
      'correl_id':correl_id,
      'in_reply_to':in_reply_to,
      'ext_client_id':ext_client_id,
      'ext_pub_time':ext_pub_time,
    }
    this.invoke('zato.pubsub.pubapi.publish-message', request, msg_id);
  }

/* **************************************************************************************************************************** */

invoke(service, request, _msg_id) {
    const msg_id = _msg_id || this.new_message_id();
    const msg = this.get_service_invoke_message(msg_id, service, request);
    console.log(`<< Invoking service with ${msg}`);

    function _handle_response() {
        return this.handle_response.bind(this)(msg_id);
        }

        this.send(msg_id, msg);
        this._wait_for_response(msg_id, _handle_response);
  }

/* **************************************************************************************************************************** */

subscribe(topic) {
    console.log(`Subscribing to '${topic}'`);
    const msg_id = this.new_message_id();
    this.invoke('zato.pubsub.pubapi.subscribe-wsx', {'topic_name':topic}, msg_id);

    function _handle_sub_key_received() {
        const response = this.response_map[msg_id];
        const sub_key = response.data.sub_key;

        if(!sub_key) {
            console.warn(`Did not receive a sub_key to ${topic} in response ${JSON.stringify(response)}`);
            return
        }
        console.log(`>> Received sub_key '${sub_key}' for topic '${topic}'`);

        // Map sub_key to topic
        this.topic_to_sub_key[topic] = sub_key;

        // Map topic to sub_key
        this.sub_key_to_topic[sub_key] = topic;

        console.log(
          `Mappings updated (sub); tsk:${JSON.stringify(this.topic_to_sub_key)} skt:${JSON.stringify(this.sub_key_to_topic)}`);
        }

    this._wait_for_sub_key(msg_id, _handle_sub_key_received);
  }

/* **************************************************************************************************************************** */

resume_subscription(sub_key, topic) {
    console.log(`Resuming sub_key '${sub_key}' to '${topic}'`);
    this.invoke('zato.pubsub.resume-wsx-subscription', {'sub_key':sub_key});
  }

/* **************************************************************************************************************************** */

unsubscribe(sub_key, topic) {
    console.log(`Unsubscribing sub_key '${sub_key}' from '${topic}'`);
    const msg_id = this.new_message_id();
    this.invoke('zato.pubsub.pubapi.unsubscribe', {'sub_key':sub_key}, msg_id);

    function _handle_unsubscribed() {
        delete this.topic_to_sub_key[topic];
        delete this.sub_key_to_topic[sub_key];
        console.log(
          `Mappings updated (unsub); tsk:${JSON.stringify(this.topic_to_sub_key)} skt:${JSON.stringify(this.sub_key_to_topic)}`);
    }
    this._wait_for_sub_key(msg_id, _handle_unsubscribed);
}

/* **************************************************************************************************************************** */

subscribe_or_resume(topic) {
    const sub_key = this.topic_to_sub_key[topic];
    if(sub_key) {
        this.resume_subscription(sub_key, topic);
    }
    else {
        this.subscribe(topic);
    }
  }

/* **************************************************************************************************************************** */

on_wsx_message(e) {

    // Log data received
    if(this.log_level >= LogLevel.Info) {
        console.log(`>> Message received ${e.data}`);
    }

    // We always expect JSON on input
    const msg = JSON.parse(e.data);

    if(msg.meta.in_reply_to) {
        this.response_map[msg.meta.in_reply_to] = msg;
    }
    else {
        this.on_message_received(this, msg, null);
    }
  }

/* **************************************************************************************************************************** */

is_client_close_event(e) {
    return e.code == 1000 && e.reason == this.get_disconnect_reason();
}

/* **************************************************************************************************************************** */

on_wsx_close(e) {
    // This function is invoked if either server or the client itself
    // closes the connection, hence we need to differentiate between the two cases.
    const is_server_closing = !(this.is_client_close_event(e));

    if(is_server_closing) {

        // Log the information about the close event taking place
        if(this._is_connected &&  this.log_level >= LogLevel.Error) {
            console.log(`>> Server at ${this.address} closed connection; code:${e.code}, reason:'${e.reason}', clean:${e.wasClean}`);
            console.log(`Reconnecting to ${this.address}`);
        }
    }

    // Clean up metadata
    this._is_connected = false;

    // Reconnect now but only if it was server that closed the connection
    if(is_server_closing) {
        this.connect();
    }
  }
};

/* **************************************************************************************************************************** */

// A callback function to be invoked for each message received from Zato
function sample_on_message_received(client, msg, in_reply_to) {
    if(in_reply_to) {
      console.log(`>> Callback received a response to '${in_reply_to}' - ${JSON.stringify(msg)}`);
  }
  else {
      console.log(`>> Callback received a request - ${JSON.stringify(msg)}`);
  }
}

/* **************************************************************************************************************************** */

// A callback function to be invoked once the client connects to Zato
function sample_when_ready(client) {
    console.log(`>> Client ${client.client_name} connected to ${client.address} as ${client.username}`);
}

/* **************************************************************************************************************************** */


module.exports = {
    "ZatoWSXClient": ZatoWSXClient,
    "sample_on_message_received": sample_on_message_received,
    "sample_when_ready": sample_when_ready
};
