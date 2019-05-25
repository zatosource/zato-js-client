/*
Copyright (C) 2019, Zato Source s.r.o. https://zato.io

Licensed under LGPLv3, see LICENSE.txt for terms and conditions.
*/

module.exports = {
  entry: "./src/zato-client.js",
  output: {
    path: __dirname + "/dist",
    filename: "bundle.js"
  },
  mode: "production",
  module: {},
  externals: {}
}
