define(['jquery'], function ($) {

  return {

    getSession: function (sessionId) {

      // it is also possible to pass a session-object
      if ($.isPlainObject(sessionId)) {
        sessionId = sessionId.sessionId;
      }

      // create the data to be passed
      return {
        sessionId: sessionId
      }
    },

    /**
     * Function to provide a login on the server-side.
     *
     * @param serverUrl
     *   the url of the server
     * @param username
     *   the name of the user to be logged in
     * @param password
     *   the password to be used for the user
     * @param callback
     *   the callback to be fired when the log-in is performed
     */
    login: function (serverUrl, username, password, callback) {
      var credentials = {
        username: username,
        password: password
      };

      this.get(serverUrl, '/auth/login', credentials, callback);
    },

    /**
     * Function to invalidate the current session on server-side.
     *
     * @param serverUrl
     *   the url of the server
     * @param sessionId
     *   the id of the session to invalidate (can also be a session object)
     * @param callback
     *   the callback to be fired when the log-out is performed
     */
    logout: function (serverUrl, sessionId, callback) {
      this.get(serverUrl, '/auth/logout', this.getSession(sessionId), callback);
    },

    /**
     * Function to retrieve information about the current session.
     *
     * @param serverUrl
     *   the url of the server
     * @param sessionId
     *   the id of the session to retrieve information for
     * @param callback
     *   the callback to be fired when the information is retrieved
     */
    sessionInfo: function (serverUrl, sessionId, callback) {
      this.get(serverUrl, '/auth/userinfo', this.getSession(sessionId), callback);
    },

    uploadFile: function (serverUrl, sessionId, form, callback) {

      // it is also possible to pass a session-object
      var session = this.getSession(sessionId);

      // create the formData object
      var formData = new FormData(form.get(0));
      formData.append('sessionId', session.sessionId);

      // create the upload
      $.ajax({
        url: serverUrl + '/loader/file',
        type: 'POST',

        // custom XMLHttpRequest
        xhr: function () {

          // check if upload property exists
          var xhr = $.ajaxSettings.xhr();
          if (xhr.upload) {
            xhr.upload.addEventListener('progress', function (event) {
              // if we want to handle upload size: event.loaded vs. event.total
              // the upload is done when event.lengthComputable is false
            }, false);
          }
          return xhr;
        },
        // ajax events
        success: function (data, textStatus, jqXHR) {
          callback(true, data);
        },
        error: function (jqXHR, textStatus, errorThrown) {
          callback(false, {error: $.parseJSON(jqXHR.responseText)});
        },
        // form data
        data: formData,
        // options to tell jQuery not to process data or worry about content-type.
        cache: false,
        contentType: false,
        processData: false
      });
    },

    loadModel: function (serverUrl, sessionId, modelId, callback) {
      this.query(serverUrl, sessionId, 'LOAD "' + modelId + '"', callback);
    },

    loadData: function (serverUrl, sessionId, modelId, offset, limit, callback) {
      this.query(serverUrl, sessionId, 'SELECT RECORDS FROM "' + modelId + '" LIMIT ' + offset + ', ' + limit, callback);
    },

    deleteModel: function (serverUrl, sessionId, modelId, callback) {
      this.query(serverUrl, sessionId, 'DROP MODEL "' + modelId + '"', callback);
    },

    unloadModel: function (serverUrl, sessionId, modelId, callback) {
      this.query(serverUrl, sessionId, 'UNLOAD "' + modelId + '"', callback);
    },

    loadModelFromFile: function (serverUrl, sessionId, file, autoload, callback) {
      var session = this.getSession(sessionId);
      this.query(serverUrl, sessionId, 'LOAD FROM \'uploaded://' + session.sessionId + '/' + file + '\' SET autoload=' + autoload, callback);
    },

    getUsers: function (serverUrl, sessionId, callback) {
      this.query(serverUrl, this.getSession(sessionId), 'GET USERS', callback);
    },

    getRoles: function (serverUrl, sessionId, callback) {
      this.query(serverUrl, this.getSession(sessionId), 'GET ROLES', callback);
    },

    getModels: function (serverUrl, sessionId, callback) {
      var session = this.getSession(sessionId);
      var data = {
        object: 'models',
        sessionId: session.sessionId
      };

      this.get(serverUrl, '/query/system', data, callback);
    },

    getModelStructure: function (serverUrl, sessionId, modelId, callback) {
      var session = this.getSession(sessionId);
      var data = {
        object: 'modelmeta',
        model: modelId,
        sessionId: session.sessionId
      };

      this.get(serverUrl, '/query/system', data, callback);
    },

    insertDbData: function (serverUrl, sessionId, modelId, connection, query, structure, callback) {
      var session = this.getSession(sessionId);
      var data = {
        object: 'adddbrecords',
        sessionId: session.sessionId,
        model: modelId,
        connection: JSON.stringify(connection),
        query: query,
        structure: JSON.stringify(structure)
      };

      this.get(serverUrl, '/query/system', data, callback);
    },

    insertCsvData: function (serverUrl, sessionId, modelId, file, separator, structure, callback) {
      var session = this.getSession(sessionId);
      var data = {
        object: 'addcsvfile',
        sessionId: session.sessionId,
        model: modelId,
        file: file,
        separator: separator,
        structure: JSON.stringify(structure)
      };

      this.get(serverUrl, '/query/system', data, callback);
    },

    insertModelData: function (serverUrl, sessionId, modelId, callback) {
      var session = this.getSession(sessionId);
      var data = {
        object: 'addmodelrecords',
        sessionId: session.sessionId,
        model: modelId
      };

      this.get(serverUrl, '/query/system', data, callback);
    },

    deleteRecord: function(serverUrl, sessionId, modelId, recordId, callback) {
      this.query(serverUrl, sessionId, 'DELETE ' + recordId + ' FROM "' + modelId + '"', callback);
    },

    ping: function (serverUrl, sessionId, callback) {
      this.get(serverUrl, '/auth/ping', this.getSession(sessionId), callback);
    },

    query: function (serverUrl, sessionId, query, callback) {

      // it is also possible to pass a session-object
      var session = this.getSession(sessionId);
      var data = {
        sessionId: session.sessionId,
        query: query
      };

      $.ajax({
        dataType: 'json',
        url: serverUrl + '/query/tsql',
        data: data,
        type: 'POST'
      }).done(function (data, textStatus, jqXHR) {
        callback(true, data);
      }).error(function (jqXHR, textStatus, reason) {

        // check if we have an additional error message
        var message;
        try {
          var errorResponse = $.parseJSON(jqXHR.responseText);
          if (errorResponse.type == 'error') {
            reason = errorResponse.message;
          }
        } catch (e) {
          // nothing to do
        }
        callback(false, {error: reason});
      });
    },

    get: function (serverUrl, url, data, callback) {
      $.ajax({
        dataType: 'json',
        url: serverUrl + url,
        data: data,
        type: 'POST'
      }).done(function (data, textStatus, jqXHR) {
        callback(true, data);
      }).fail(function (jqXHR, textStatus, reason) {

        // check if we have an additional error message
        var message;
        try {
          var errorResponse = $.parseJSON(jqXHR.responseText);
          if (errorResponse.type == 'error') {
            reason = errorResponse.message;
          }
        } catch (e) {
          // nothing to do
        }

        console.log(reason);

        callback(false, {error: reason});
      });
    }
  };
});