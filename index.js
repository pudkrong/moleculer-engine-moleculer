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
    return function log (context, callback) {
      return process.nextTick(function () { callback(null, context); });
    };
  }

  if (rs.think) {
    return this.helpers.createThink(rs, _.get(self.config, 'defaults.think', {}));
  }

  if (rs.spawn) {
    return function spawn (context, callback) {
      const opts = _.defaults(rs.options, context.args);

      ee.emit('spawn');
      const startedAt = process.hrtime();

      const params = [];
      for (let p in opts) {
        if (p !== 'services') params.push(`--${p}`);
        params.push(opts[p]);
      }

      // Using uuid as node id to make sure we have unique id
      process.env.NODEID = context.vars.$uuid;
      context.runner.start(['node', 'moleculer-runner', ...params])
        .then((broker) => {
          // process.on('SIGINT', () => {
          //   console.log('BROKER STOP');
          //   broker.stop();
          // });

          const endedAt = process.hrtime(startedAt);
          let delta = (endedAt[0] * 1e9) + endedAt[1];
          ee.emit('response', delta, 0);

          return callback(null, context);
        })
        .catch((error) => {
          debug(error);
          return callback(error, context);
        });
    };
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
      process.on('SIGINT', () => {
        initialContext.runner.broker.stop()
          .then(() => {
            console.log('STOP broker');
          })
          .catch(error => {
            console.error('ERROR STOP BROKER');
          });
      });

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
