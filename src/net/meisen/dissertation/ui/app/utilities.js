define(['jquery', 'net/meisen/dissertation/ui/app/model', 'net/meisen/dissertation/ui/app/server/tidaAPI'], function ($, model, tidaAPI) {

  return {

    isWebsite: function() {
      var href = window.location.href;
      if (href.indexOf('http://tida.meisen.net/') == 0 ||
          href.indexOf('http://timedata.meisen.net/') == 0) {
        return true;
      } else {
        return false;
      }
    },

    getError: function (error) {

      if (error instanceof Error) {
        msg = error.message;
      } else if (typeof(error) == 'string') {
        msg = (error.trim() == '' ? 'Unspecified error' : error);
      } else if ($.isPlainObject(error)) {
        if ($.isArray(error.messages)) {
          msg = error.messages.join('</li><li>');
          msg = '<ul><li>' + msg + '</li></ul>';
        } else if (typeof(error.message) == 'string') {
          this.getError(error.message);
        } else if (typeof(error.error) == 'string') {
          this.getError(error.error);
        } else if (error.error == null) {
          msg = 'Unspecified error';
        } else {

          // fallback
          msg = error;
        }
      } else {
        // fallback
        msg = error;
      }

      return msg;
    },

    formatTime: function (time) {
      var hours = parseInt(time / 60);
      var minutes = time % 60;
      var formatted = (hours < 10 ? '0' + hours : hours) + ':' + (minutes < 10 ? '0' + minutes : minutes);

      return formatted;
    },

    appendLoading: function (parent) {
      var parentType = typeof(parent);
      parent = parentType == 'undefined' ? $('body') : (parentType == 'string' ? $(parent) : parent);

      var modalLoading = '';
      modalLoading += '<div class="modal fade" id="modalLoading" tabindex="-1" role="dialog" aria-labelledby="modalLoadingTitle" aria-hidden="true">';
      modalLoading += '  <div class="modal-dialog">';
      modalLoading += '    <div class="modal-content">';
      modalLoading += '      <div class="modal-header">';
      modalLoading += '        <h4 id="modalLoadingTitle" class="modal-title"></h4>';
      modalLoading += '      </div>';
      modalLoading += '      <div class="modal-body">';
      modalLoading += '        <div id="loadingIcon" class="text-center"><span style="font-size: 5em" class="glyphicon glyphicon-refresh glyphicon-refresh-animate"></span></div>';
      modalLoading += '        <div id="loadingFailed" class="hide bs-callout bs-callout-danger"><h4></h4><div></div></div>';
      modalLoading += '      </div>';
      modalLoading += '      <div class="modal-footer">';
      modalLoading += '        <button type="button" style="visibility:hidden" class="btn btn-primary" data-dismiss="modal">Close</button>';
      modalLoading += '      </div>';
      modalLoading += '    </div>';
      modalLoading += '  </div>';
      modalLoading += '</div>';

      // add a listener to reset everything after hiding
      var $modalLoading = $(modalLoading);
      $modalLoading.on('hidden.bs.modal', function () {
        var $loadingFailed = $modalLoading.find('#loadingFailed');

        $loadingFailed.children('h4').text('');
        $loadingFailed.children('div').text('');
        $loadingFailed.addClass('hide');

        $modalLoading.find('#modalLoadingTitle').text('');
        $modalLoading.find('button').css('visibility', 'hidden');
        $modalLoading.find('#loadingIcon').removeClass('hide');
      });

      $modalLoading.appendTo(parent);
    },

    handleLoading: function (retriever, callback, mainTitle, title, message) {
      var _ref = this;

      // just make sure there is one
      if (!$.isFunction(retriever)) {
        return;
      }

      var $modalLoading = $('#modalLoading');
      $modalLoading.find('#modalLoadingTitle').text(typeof(mainTitle) == 'undefined' ? 'Retrieving information from server...' : mainTitle);
      $modalLoading.modal({
        backdrop: 'static'
      });
      $modalLoading.modal('show');

      // call the retriever and handle the result
      retriever(function (status, data) {
        if (status) {
          $modalLoading.modal('hide');

          if ($.isFunction(callback)) {
            callback(status, data);
          }
        } else {
          var $loadingFailed = $modalLoading.find('#loadingFailed');

          $loadingFailed.children('h4').text(typeof(title) == 'undefined' ? 'Failed' : title);
          $loadingFailed.children('div').text(typeof(message) == 'undefined' ? _ref.getError(data) : message);
          $loadingFailed.removeClass('hide');

          $modalLoading.find('button').css('visibility', 'visible');
          $modalLoading.find('#loadingIcon').addClass('hide');

          // trigger the callback, even on error
          callback(status, data);
        }
      });
    },

    appendLogout: function (parent) {
      var parentType = typeof(parent);
      parent = parentType == 'undefined' ? $('body') : (parentType == 'string' ? $(parent) : parent);

      var modalLogout = '';
      modalLogout += '<div class="modal fade" id="modalLogout" tabindex="-1" role="dialog" aria-labelledby="modalLogoutTitle" aria-hidden="true">';
      modalLogout += '  <div class="modal-dialog">';
      modalLogout += '    <div class="modal-content">';
      modalLogout += '      <div class="modal-header">';
      modalLogout += '        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>';
      modalLogout += '        <h4 id="modalLogoutTitle" class="modal-title">Logout</h4>';
      modalLogout += '      </div>';
      modalLogout += '      <div class="modal-body">';
      modalLogout += '        <p>Do you really want to logout? All session dependent settings will be lost!</p>';
      modalLogout += '      </div>';
      modalLogout += '      <div class="modal-footer">';
      modalLogout += '        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>';
      modalLogout += '        <button id="btnLogoutVerified" type="button" class="btn btn-primary">Logout</button>';
      modalLogout += '      </div>';
      modalLogout += '    </div>';
      modalLogout += '  </div>';
      modalLogout += '</div>';

      var modalExpired = '';
      modalExpired += '<div class="modal fade" id="modalExpired" tabindex="-1" role="dialog" aria-labelledby="modalExpiredTitle" aria-hidden="true">';
      modalExpired += '  <div class="modal-dialog">';
      modalExpired += '    <div class="modal-content">';
      modalExpired += '      <div class="modal-header">';
      modalExpired += '        <h4 id="modalExpiredTitle" class="modal-title">Session expired</h4>';
      modalExpired += '      </div>';
      modalExpired += '      <div class="modal-body">';
      modalExpired += '        <p>Your session expired. All the session dependent data is lost. You can ignore this message and close it! Nevertheless, the system is in an undefined stat afterwards.</p>';
      modalExpired += '      </div>';
      modalExpired += '      <div class="modal-footer">';
      modalExpired += '        <button type="button" class="btn btn-default" data-dismiss="modal">Close (not recommended)</button>';
      modalExpired += '        <button id="btnExpiredVerified" type="button" class="btn btn-primary">Redirect</button>';
      modalExpired += '      </div>';
      modalExpired += '    </div>';
      modalExpired += '  </div>';
      modalExpired += '</div>';

      var modalSessionInfo = '';
      modalSessionInfo += '<div class="modal fade" id="modalSessionInfo" tabindex="-1" role="dialog" aria-labelledby="modalSessionInfoTitle" aria-hidden="true">';
      modalSessionInfo += '  <div class="modal-dialog">';
      modalSessionInfo += '    <div class="modal-content">';
      modalSessionInfo += '      <div class="modal-header">';
      modalSessionInfo += '        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>';
      modalSessionInfo += '        <h4 id="modalSessionInfoTitle" class="modal-title">Session information</h4>';
      modalSessionInfo += '      </div>';
      modalSessionInfo += '      <div class="modal-body">';
      modalSessionInfo += '        <div class="row"><div class="col-md-3">Username</div><div class="col-md-1">:</div><div id="username" class="col-md-8"></div></div>';
      modalSessionInfo += '        <div class="row"><div class="col-md-3">SessionId</div><div class="col-md-1">:</div><div id="sessionid" class="col-md-8"></div></div>';
      modalSessionInfo += '        <div class="row"><div class="col-md-3">Login time</div><div class="col-md-1">:</div><div id="logintime" class="col-md-8"></div></div>';
      modalSessionInfo += '        <div class="row"><div class="col-md-3">Timeout (hh:mm)</div><div class="col-md-1">:</div><div id="timeout" class="col-md-8"></div></div>';
      modalSessionInfo += '        <div class="row"><div class="col-md-3">Expires (hh:mm)</div><div class="col-md-1">:</div><div id="expires" class="col-md-8"></div></div>';
      modalSessionInfo += '      </div>';
      modalSessionInfo += '      <div class="modal-footer">';
      modalSessionInfo += '        <button type="button" class="btn btn-primary" data-dismiss="modal">Close</button>';
      modalSessionInfo += '      </div>';
      modalSessionInfo += '    </div>';
      modalSessionInfo += '  </div>';
      modalSessionInfo += '</div>';

      // append it
      parent.append(modalLogout);
      parent.append(modalExpired);
      parent.append(modalSessionInfo);

      // add the click for the logout button
      $('#btnLogoutVerified').click(function (event) {
        window.location.replace('logout.html');
      });
      $('#btnExpiredVerified').click(function (event) {
        window.location.replace('index.html');
      });

      // add an observer if the session expires
      var _ref = this;
      var intervalHandler = setInterval(function () {
        tidaAPI.sessionInfo(model.serverSettings.getCurrent(), model.session.getCurrent(), function (status, data) {
          if (status && !$.isEmptyObject(data) && data != null) {
            $('#username').text(data.username);
            $('#sessionid').text(data.sessionId);
            $('#logintime').text(data.logintime);
            $('#timeout').text(_ref.formatTime(data.timeoutInMin));
            $('#expires').text(_ref.formatTime(data.leftTimeoutInMin));
          } else {
            window.clearInterval(intervalHandler);
            model.clean();

            $('#modalExpired').modal({
              backdrop: 'static',
              keyboard: false
            });
            $('#modalExpired').modal('show');
          }
        });
      }, 1000);
    }
  };
});