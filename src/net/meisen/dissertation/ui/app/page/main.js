define(['jquery', 'net/meisen/dissertation/ui/app/utilities'], function ($, util) {

  return function () {

    // determine what kind of version we are using
    if (util.isWebsite()) {
      $('#download').removeClass('hide');
    } else {
      $('#server').removeClass('hide');
    }

    // check if we can logout, i.e. if a session is available
    util.setupNav($('.navbar'));

    // add the license
    util.createLicense($('body'));
  };
});