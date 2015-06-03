define([
    'jquery',
    'net/meisen/dissertation/ui/app/server/tidaAPI',
    'net/meisen/dissertation/ui/app/model'
  ],
  function ($,
            tidaAPI,
            model) {


    return function () {
      tidaAPI.logout(model.serverSettings.getCurrent(), model.session.getCurrent(), function (status, data) {

        // remove the session for sure
        model.clean();

        if (status) {
          window.location.replace('main.html');
        } else {
          $('#panelWaiting').addClass('hide');
          $('#calloutLogoutFailed').removeClass('hide');
        }
      });
    };
  });