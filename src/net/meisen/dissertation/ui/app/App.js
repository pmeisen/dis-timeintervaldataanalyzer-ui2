requirejs.config({

  // define the baseUrl defined by the processenabler
  baseUrl: 'scripts',

  // shim amplify it's not AMD conform
  shim: {
    'amplify': {
      deps: ['jquery'],
      exports: 'amplify'
    },
    'bootstrap': {
      deps: ['jquery'],
      exports: 'bootstrap'
    },
    'typeahead': {
      deps: ['jquery', 'bootstrap'],
      exports: 'typeahead'
    },
    'highcharts': {
      deps: ['jquery'],
      exports: 'highcharts'
    }
  }
});

// get jquery and all available pages
require([
  'jquery',
  'bootstrap',
  'net/meisen/dissertation/ui/app/model',
  'net/meisen/dissertation/ui/app/page/index',
  'net/meisen/dissertation/ui/app/page/login',
  'net/meisen/dissertation/ui/app/page/logout',
  'net/meisen/dissertation/ui/app/page/main',
  'net/meisen/dissertation/ui/app/page/analyze',
  'net/meisen/dissertation/ui/app/page/docs',
  'net/meisen/dissertation/ui/app/page/error'
], function ($,
             bootstrap,
             model,
             index,
             login,
             logout,
             main,
             analyze,
             docs,
             error) {

  // get the current page
  var $body = $('body');
  var type = $body.attr('data-type');

  // make sure we have values
  type = typeof type !== 'string' || type.trim() == '' || type.replace(/session|global/g, '') ? 'session' : type;

  // check if we have a valid session
  if (type == 'session') {
    var session = model.session.getCurrent();

    // validate the session, if not valid redirect to login
    if (!$.isPlainObject(session) || session == null || typeof(session) == 'undefined') {

      // remove the session information
      model.clean();
      window.location.replace('login.html');

      return;
    }
  }

  // require the function of the page, validate it, and execute
  var page = $body.attr('data-page');
  if (model.page.validate(page)) {
    var funcPage = null;
    try {
      funcPage = eval(page);
    } catch (e) {
      funcPage = null;
    }

    if (funcPage != null && $.isFunction(funcPage)) {
      model.page.update(page);
      funcPage();
    } else {
      window.location.replace('error.html');
    }
  } else {
    window.location.replace('error.html');
  }
});