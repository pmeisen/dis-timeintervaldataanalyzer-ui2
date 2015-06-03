define(['jquery', 'amplify'], function ($, amplify) {

  return {

    /**
     * Method to remove all data of the current session.
     */
    clean: function () {
      $.each(amplify.store.sessionStorage(), function (storeKey) {
        amplify.store.sessionStorage(storeKey, null);
      });
    },

    /**
     * Object to handle the navigation on the page.
     */
    page: {
      getLastPage: function (fallback) {
        var lastPage = amplify.store.sessionStorage('lastPage');
        if (this.validate(lastPage)) {
          return lastPage;
        } else {
          return fallback;
        }
      },

      validate: function (page) {
        return typeof(page) == 'string' && page.trim() !== '' && page.replace(/[a-z]/g, '') == '';
      },

      update: function (lastPage) {
        if (this.validate(lastPage) && lastPage != 'index' && lastPage != 'error') {
          amplify.store.sessionStorage('lastPage', lastPage);
          return true;
        } else {
          return false;
        }
      }
    },

    /**
     * Object holding general session information.
     */
    map: {
      get: function (key, fallback) {
        var value = amplify.store.sessionStorage('map_' + key);
        value = typeof(value) == 'undefined' ? fallback : value;

        return value;
      },

      set: function (key, value) {
        amplify.store.sessionStorage('map_' + key, value);
      }
    },

    /**
     * Object holding session information.
     */
    session: {
      update: function (serverSession) {
        if (this.validate(serverSession)) {
          amplify.store.sessionStorage('session', serverSession);
          return true;
        } else {
          return false;
        }
      },

      validate: function (serverSession) {
        return $.isPlainObject(serverSession);
      },

      getCurrent: function () {
        return amplify.store.sessionStorage('session');
      }
    },

    /**
     * Object providing some functionality for serverSettings, i.e.,
     * validate, getDefault, or getCurrent.
     */
    serverSettings: {
      validate: function (serverUrl) {
        return typeof(serverUrl) === 'string' && serverUrl.trim() != '' && serverUrl.toLowerCase().indexOf('http://') == 0;
      },

      update: function (serverUrl) {
        if (this.validate(serverUrl)) {
          amplify.store.localStorage('serverUrl', serverUrl);
          return true;
        } else {
          return false;
        }
      },

      getDefault: function () {
        return (location.origin ? location.origin : location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : ''));
      },

      getCurrent: function () {
        var serverUrl = amplify.store.localStorage('serverUrl');
        serverUrl = this.validate(serverUrl) ? serverUrl : this.getDefault();

        return serverUrl;
      }
    }
  };

});