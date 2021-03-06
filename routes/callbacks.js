/*
Copyright 2016 Capital One Services, LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.
*/

/* Exposes callbacks that can be called by webhooks. */

var express = require('express')
var tasks = require('../models/tasks')
var photos = require('../models/photos')
var webhookConfirmation = require('../models/webhookConfirmation')
var notifier = require('../notifier')
var debug = require('debug')('swiftid:callbacks')

module.exports = function (clientId) {
  var router = express.Router()

  /**
   * Called by SwiftID when a request is approved or rejected.
   */
  router.post('/photos/request-access-hook', function (req, res, next) {
    var webhookValidation = req.get('webhookValidation')
    debug('webhookValidation: ' + webhookValidation)

    // If the webhookValidationId is "true", then this is just a ping after
    // registering a webhook. There is nothing to do in that case.
    if (webhookValidation !== 'true') {
      debug('Handling photo access hook callback')
      var taskStatus = req.body.taskStatus
      var taskReferenceId = req.body.taskReferenceId

      // Find the SwiftID task that was completed.
      tasks.findById(taskReferenceId, function (taskErr, task) {
        if (taskErr) {
          console.error(taskErr)
          return
        }
        if (!task) {
          console.error('No task found with ID ' + taskReferenceId)
          return
        }

        // Find the photo for that task.
        photos.findById(task.photoId, function (photoErr, photo) {
          if (photoErr) {
            console.error(photoErr)
            return
          }
          if (!photo) {
            console.error('No photo found with ID ' + task.photoId)
            return
          }

          // Update the status on the task.
          tasks.updateValues(taskReferenceId, { status: taskStatus }, function (updateErr) {
            if (updateErr) {
              console.error(updateErr)
              return
            }

            // If accepted, add the user to sharedWith on the photo.
            if (taskStatus === 'APPROVED') {
              photos.addSharedUserId(photo._id, task.requestorId, function (addSharedErr) {
                if (addSharedErr) {
                  console.error(addSharedErr)
                  return
                }
              })
            }
            // Notify any listeners that the task has been changed
            notifier.emit('task-status-changed', {
              photoId: photo._id,
              requestorId: task.requestorId,
              status: taskStatus
            })
          })
        })
      })
    }
    else {
      debug('Confirming photo access hook callback')
      // Assume there is only one webhook to load.
      webhookConfirmation.confirm(function(err) {})
    }

    // SwiftID expects to see this header with a 2xx response when calling
    // the webhook. We send this response regardless of what happens when
    // processing the approval/rejection, so we don't wait for results.
    res.set('X-C1-Verification', clientId)
    res.send()
  })

  return router
}
