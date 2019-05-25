<!doctype html>
<html>
<head>

<meta content="text/html;charset=utf-8" http-equiv="Content-Type">
<meta content="utf-8" http-equiv="encoding">

  <script language="text/javascript">

class WSXClient {

  constructor(name, address, username, password) {
    this.name = name;
    this.address = address;
    this.username = username;
    this.password = password;
  }

  connect() {
    console.log('Connecting to '+ this.address);
  }

};

const client_name = 'My API Client';
const address     = 'ws://localhost:50100/myapi'
const username    = 'username1';
const password    = 'password1';

const client = new WSXClient(address, username, password)
client.connect();

  </script>
</head>
<body>
</body>
