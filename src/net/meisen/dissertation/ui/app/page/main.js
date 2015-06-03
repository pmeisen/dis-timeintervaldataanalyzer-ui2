define(['jquery', 'net/meisen/dissertation/ui/app/model', 'net/meisen/dissertation/ui/app/utilities'], function ($, model, util) {

  return function () {

    // determine what kind of version we are using
    if (util.isWebsite()) {
      $('#download').removeClass('hide');
    } else {
      $('#server').removeClass('hide');
    }

    // check if we can logout, i.e. if a session is available
    var session = model.session.getCurrent();
    if (model.session.validate(session)) {
      util.appendLogout();
    } else {
      $('.navbar [data-session="needed"]').addClass('hide');
    }

    util.createLicense($('body'));
  };
});