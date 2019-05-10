travelerGlobal.usernames = new Bloodhound({
  datumTokenizer: function (user) {
    return Bloodhound.tokenizers.whitespace(user.displayName);
  },
  queryTokenizer: Bloodhound.tokenizers.whitespace,
  identify: function (user) {
    return user.displayName;
  },
  prefetch: {
    url: basePath + '/adusernames',
    cacheKey: 'adusernames'
  }
});
