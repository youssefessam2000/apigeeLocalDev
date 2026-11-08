// Runs Apigee JavaScript policy resources outside Apigee.
// Like the JavaScript policy, the IncludeURL files and the ResourceURL file share one global scope,
// and "context" reads and writes flow variables. Here the flow variables are a plain object.
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APIGEE_ROOT = path.resolve(__dirname, "../../../src/main/apigee");

const BUNDLE = {
  petstore: "apiproxies/petstore-v1/apiproxy/resources/jsc",
  envelope: "sharedflows/common-envelope/sharedflowbundle/resources/jsc"
};

function resourcePath(bundle, file) {
  return path.join(APIGEE_ROOT, BUNDLE[bundle], file);
}

// Flow variables the way the policy sees them: an unset variable reads as null.
function createContext(initial) {
  const vars = Object.assign({}, initial);
  return {
    vars,
    getVariable(name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : null;
    },
    setVariable(name, value) {
      vars[name] = value;
    },
    removeVariable(name) {
      delete vars[name];
    }
  };
}

// Runs the files of one bundle in order (IncludeURL files first, ResourceURL last)
// and returns the flow variables afterwards.
function runPolicy(bundle, files, variables) {
  const context = createContext(variables);
  const sandbox = vm.createContext({ context });
  files.forEach(function (file) {
    const filename = resourcePath(bundle, file);
    new vm.Script(fs.readFileSync(filename, "utf8"), { filename }).runInContext(sandbox);
  });
  return context.vars;
}

module.exports = { runPolicy, resourcePath };
