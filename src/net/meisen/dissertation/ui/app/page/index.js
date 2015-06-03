define(['net/meisen/dissertation/ui/app/model'], function (model) {
  return function () {

    // get the last page 
    var page = model.page.getLastPage('main');

    // redirect to the page
    window.location.replace(page + '.html')
  };
});