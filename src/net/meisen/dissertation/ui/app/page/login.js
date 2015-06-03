define([
    'jquery',
    'net/meisen/dissertation/ui/app/server/tidaAPI',
    'net/meisen/dissertation/ui/app/model'
  ],
  function ($,
            tidaAPI,
            model) {

    // make sure we don't have a valid session
    var session = model.session.getCurrent();
    if (model.session.validate(session)) {

      // we redirect to the last page, default is analyze
      return function () {
        var page = model.page.getLastPage('analyze');
        page = page == 'login' ? 'analyze' : page;
        window.location.replace(page + '.html');
      };
    } else {

      // return the function to bind the functionality to the UI elements
      return function () {

        // add validation to input field
        var $serverUrl = $('#serverUrl');
        var validate = function () {
          var serverUrl = $serverUrl.val();
          var $serverUrlWrap = $serverUrl.parent();
          var $serverUrlGlyph = $formServerSettings.find('span.glyphicon');

          if (model.serverSettings.validate(serverUrl)) {
            $serverUrlWrap.removeClass('has-error');
            $serverUrlWrap.addClass('has-success');

            $serverUrlGlyph.removeClass('glyphicon-remove');
            $serverUrlGlyph.addClass('glyphicon-ok');
          } else {
            $serverUrlWrap.removeClass('has-success');
            $serverUrlWrap.addClass('has-error');

            $serverUrlGlyph.removeClass('glyphicon-ok');
            $serverUrlGlyph.addClass('glyphicon-remove');
          }
        };
        $serverUrl.keyup(validate);
        $serverUrl.on('input', validate);

        // add the setting of the serverUrl to the modal
        var $modalServerSettings = $('#modalServerSettings');
        $modalServerSettings.on('show.bs.modal', function (e) {
          $serverUrl.val(model.serverSettings.getCurrent());
          validate();
        });

        // handle click event on serverSettings
        var $formServerSettings = $('#formServerSettings');
        $formServerSettings.submit(function (event) {

          // get the values set
          var serverUrl = $serverUrl.val();
          if (model.serverSettings.update(serverUrl)) {
            $modalServerSettings.modal('hide');
          }

          // make sure the event is not further used
          event.preventDefault();
        });

        // handle click event on login
        $('#formLogin').submit(function (event) {

          // get credentials
          var username = $('#inputUser').val();
          var password = $('#inputPassword').val();

          // disable the inputs and show the loading
          var $btn = $('#btnLogin').button('loading');

          // do the login
          tidaAPI.login(model.serverSettings.getCurrent(), username, password, function (status, data) {

            if (status) {
              model.session.update(data);

              // forward to the first page
              window.location.replace('analyze.html');
            } else {
              $('#lblError').text(data.error);
              $('#calloutLoginFailed').removeClass('hide');

              // clean-up, enable button and inputs
              $btn.button('reset');
            }
          });

          // stop further propagation
          event.preventDefault();
        });
      }
    }
    ;
  });