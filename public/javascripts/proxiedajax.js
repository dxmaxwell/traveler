/*global window: false*/

function updateAjaxURL(prefix) {
  if (prefix) {
    $.ajaxPrefilter(function (options) {
      options.url = prefix + options.url;
    });
  }
}

function ajax401(prefix) {
  $(document).ajaxError(function (event, jqXHR, settings, exception) {
    if (jqXHR.status === 401) {
      $('#message').append('<div class="alert alert-error"><button class="close" data-dismiss="alert">x</button>Please click <a href="' + prefix + '/" target="_blank">travler home</a>, log in, and then save the changes on this page.</div>');
      $(window).scrollTop($('#message div:last-child').offset().top - 40);
    } else if (jqXHR.status >= 400) {
      $('#message').append('<div class="alert alert-error"><button class="close" data-dismiss="alert">x</button>' + jqXHR.responseText || exception + '</div>');
      $(window).scrollTop($('#message div:last-child').offset().top - 40);
    }
  });
}
