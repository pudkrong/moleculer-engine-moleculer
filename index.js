'use strict';

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const debug = require('debug')('engine:moleculer');
const A = require('async');
const _ = require('lodash');
const helpers = require('artillery/core/lib/engine_util');
const { spawn } = require('child_process');
const { Runner } = require('moleculer');
const { countReset } = require('console');
const engineUtil = require('./engine_util');
const template = engineUtil.template;
const os = require('os');
function MoleculerEngine (script, ee) {
  this.script = script;
  this.ee = ee;
  this.helpers = helpers;
  this.config = script.config;

  return this;
}

MoleculerEngine.prototype.createScenario = function createScenario (scenarioSpec, ee) {
  const tasks = scenarioSpec.flow.map(rs => this.step(rs, ee));

  return this.compile(tasks, scenarioSpec.flow, ee);
};

MoleculerEngine.prototype.step = function step (rs, ee, opts) {
  opts = opts || {};
  let self = this;

  // if (rs.loop) {
  //   // console.log(rs.loop, rs.count);
  //   let steps = _.map(rs.loop, function (rs) {
  //     return self.step(rs, ee, opts);
  //   });

  //   return this.helpers.createLoopWithCount(
  //     rs.count || -1,
  //     steps,
  //     {
  //       loopValue: rs.loopValue || '$loopCount',
  //       overValues: rs.over,
  //       whileTrue: self.config.processor
  //         ? self.config.processor[rs.whileTrue] : undefined
  //     });
  // }

  if (rs.log) {
    return function(context, callback) {
      console.log(template(rs.log, context));
      return process.nextTick(function() { callback(null, context); });
    };
  }

  if (rs.think) {
    return this.helpers.createThink(rs, _.get(self.config, 'defaults.think', {}));
  }

  if (rs.spawn) {
    return function spawn (context, callback) {
      const opts = _.defaults(rs.options, context.args);

      const startedAt = process.hrtime();

      const params = [];
      for (let p in opts) {
        if (p !== 'services') params.push(`--${p}`);
        params.push(opts[p]);
      }

      // Using uuid as node id to make sure we have unique id
      const name = template(rs.spawn.name, context) || os.hostname();
      context.vars.nodeId = `${name}-${_.uniqueId()}`;
      context.runner.start(['node', 'moleculer-runner', ...params])
        .then((broker) => {
          const endedAt = process.hrtime(startedAt);
          let delta = (endedAt[0] * 1e9) + endedAt[1];
          ee.emit('histogram', `spawn.response_time`, delta / 1e6);

          return callback(null, context);
        })
        .catch((error) => {
          debug(error);
          ee.emit('error', `spawn - ${context.vars.nodeId}`);
          return callback(error, context);
        });
    };
  }

  if (rs.stop) {
    return function stop (context, callback) {
      console.log(`Stop: ${context.vars.nodeId}`);

      const startedAt = process.hrtime();
      const stopTimer = setTimeout(() => {
        console.log(`Force Stop ${context.vars.nodeId}`);
        return callback(null, context);
      }, 3000);

      context.runner.broker.stop()
        .then(() => {
          const endedAt = process.hrtime(startedAt);
          let delta = (endedAt[0] * 1e9) + endedAt[1];
          ee.emit('histogram', `stop.response_time`, delta / 1e6);
          console.log(`Stopped ${context.vars.nodeId}`);
          return callback(null, context);
        })
        .catch(error => {
          ee.emit('error', `stop - ${context.vars.nodeId}`);
          console.log(`Stopped error ${context.vars.nodeId}`);
          return callback(error, context);
        })
        .finally(() => {
          clearTimeout(stopTimer);
        });
    }
  }

  return function (context, callback) {
    return callback(null, context);
  };
};

MoleculerEngine.prototype.compile = function compile (tasks, scenarioSpec, ee) {
  const self = this;
  return function scenario (initialContext, callback) {
    const init = function init (next) {
      let opts = {
        config: self.script.config.moleculer.config || 'moleculer.config.js',
        services: self.script.config.moleculer.services || 'services/**/*.service.js'
      };

      initialContext.runner = new Runner();
      initialContext.args = opts;

      ee.emit('started');
      return next(null, initialContext);
    };

    let steps = [init].concat(tasks);

    A.waterfall(
      steps,
      function done (err, context) {
        if (err) {
          debug(err);
        }

        return callback(err, context);
      });
  };
};

MoleculerEngine.prototype.$increment = function $increment (value) {
  let result = Number.isInteger(value) ? value += 1 : NaN;
  return result;
};

MoleculerEngine.prototype.$decrement = function $decrement (value) {
  let result = Number.isInteger(value) ? value -= 1 : NaN;
  return result;
};

module.exports = MoleculerEngine;
