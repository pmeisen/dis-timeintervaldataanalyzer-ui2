define(['jquery', 'net/meisen/dissertation/ui/app/utilities'], function ($, util) {

  return function () {

    // check if we can logout, i.e. if a session is available
    util.setupNav($('.navbar'));

    // add the scrollspy to make the menu on the left nicer
    $('body').scrollspy({target: '#navbarContent'});

    // add the license
    util.createLicense($('body'));
  };
});