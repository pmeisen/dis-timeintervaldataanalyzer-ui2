define(['jquery', 'net/meisen/dissertation/ui/app/utilities'], function ($, util) {

  return function () {

    // fix the download link if not on webpage
    if (!util.isWebsite()) {
      var $hrefDownload = $('#hrefDownload');
      $hrefDownload.attr('href', 'http://tida.meisen.net/' + $hrefDownload.attr('href'));
    }


  };
});