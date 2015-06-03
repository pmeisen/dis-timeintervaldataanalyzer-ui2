define(['jquery', 'net/meisen/dissertation/ui/app/utilities'], function ($, util) {

  return function () {

    $('#btnDownload').click(function() {
      var url = (util.isWebsite() ? '' : 'http://tida.meisen.net/') + 'downloads/tidais-TRUNK-SNAPSHOT.zip';
      window.location.href = url;
    });
  };
});