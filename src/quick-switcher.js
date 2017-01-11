define(['require'], function (require) {
  var $ = jQuery;
  var exports = window;

  var ResultHandler = {
    filters: {
      isFuzzyMatch: function(needle, haystack) {
        for (var i = 0, j = 0; i < needle.length && j < haystack.length; i++) {
          while (j < haystack.length) {
            j++;
            if (needle.charAt(i) === haystack.charAt(j)) {
              break;
            }
          }
        }

        return j < haystack.length;
      },

      areWordsFound: function(needle, haystack) {
        var pieces = needle.split(/[^\w]/);
        for (var i = 0; i < pieces.length; i++) {
          if (haystack.indexOf(pieces[i]) === -1) {
            return false;
          }
        }

        return true;
      },

      isMatch: function(needle, haystack) {
        if (haystack.indexOf(needle) !== -1) {
          return true;
        } else if (this.areWordsFound(needle, haystack)) {
          return true;
        }

        return false;
        //return this.isFuzzyMatch(needle, haystack);
      }
    }
  };

  var QuickSwitcher = {
    init: function ($parentDom, searchCallback, selectCallback, options) {
      this.$parentDom = null;
      this.$liCollection = null;
      this.valueObjects = null;
      this.selectedIndex = null;
      this.$results = null;
      this.$noSearchTerms = null;
      this.$noResults = null;
      this.$loading = null;
      this.$breadcrumb = null;
      this.$search = null;
      this.searchText = '';
      this.searchDelayTimeout = null;
      this.searchId = 0;

      this.options = $.extend({'searchDelay': 1000}, options);

      this.initDomElement($parentDom);
      this.searchCallback = searchCallback;
      this.abortSearchCallback = null;
      this.searchDelay = this.options.searchDelay;
      this.selectCallback = selectCallback;
      this.callbackStack = [];
    },

    initDomElement: function ($parentDom) {
      var qSwitcher = this;

      this.$parentDom = $parentDom;
      this.$domElement = $(
        '<div class="lstr-qswitcher-overlay">' +
        '</div>' +
        '<div class="lstr-qswitcher-container">' +
        '  <form class="lstr-qswitcher-popup">' +
        '    <div class="lstr-qswitcher-breadcrumb">' +
        '    </div>' +
        '    <div class="lstr-qswitcher-help">' +
        '      <ul>' +
        '        <li><em>&#8597;</em> to navigate</li>' +
        '        <li><em>&#8629;</em> to select</li>' +
        '        <li><em>&#9003;</em> to clear</li>' +
        '        <li><em>esc</em> to dismiss</li>' +
        '      </ul>' +
        '    </div>' +
        '    <input type="text" class="lstr-qswitcher-search form-control" />' +
        '    <div class="lstr-qswitcher-loading">Loading...</div>' +
        '    <div class="lstr-qswitcher-no-terms"></div>' +
        '    <div class="lstr-qswitcher-no-results">No results found</div>' +
        '    <div class="lstr-qswitcher-oops-results">Oops! Something went wrong while trying to load your results.</div>' +
        '    <div class="lstr-qswitcher-results"></div>' +
        '  </form>' +
        '</div>'
      );

      $parentDom.append(this.$domElement);

      this.$breadcrumb = this.$domElement.find('.lstr-qswitcher-breadcrumb');
      this.$search = this.$domElement.find('.lstr-qswitcher-search');
      this.$loading = this.$domElement.find('.lstr-qswitcher-loading');
      this.$results = this.$domElement.find('.lstr-qswitcher-results');
      this.$noSearchTerms = this.$domElement.find('.lstr-qswitcher-no-terms');
      this.$noResults = this.$domElement.find('.lstr-qswitcher-no-results');
      this.$oopsResults = this.$domElement.find('.lstr-qswitcher-oops-results');

      this.$domElement.find('.lstr-qswitcher-popup').on('submit', function (event) {
        event.preventDefault();
      });
      this.$parentDom.find('.lstr-qswitcher-overlay').on('click', function (event) {
        qSwitcher.closeSwitcher();
        event.preventDefault();
      });
      this.$parentDom.on('keydown', function (event) {
        if ((event.metaKey || event.ctrlKey) && event.which === 75) {
          qSwitcher.toggleSwitcher();
          event.preventDefault();
        }
      });
      $('html').on('keydown', '.lstr-qswitcher-noscroll', function (event) {
        if (event.which === 38) { // up arrow key
          qSwitcher.selectIndex(qSwitcher.selectedIndex - 1);
          qSwitcher.scrollToSelectedItem();
          event.preventDefault();
        } else if (event.which === 40) { // down arrow key
          qSwitcher.selectIndex(qSwitcher.selectedIndex + 1);
          qSwitcher.scrollToSelectedItem();
          event.preventDefault();
        } else if (event.which === 27) { // escape key
          qSwitcher.toggleSwitcher();
          event.preventDefault();
        } else if (13 === event.keyCode) {
          var $li = $(this);
          qSwitcher.triggerSelect(qSwitcher.selectedIndex, event);
          event.preventDefault();
        }
      });
      this.$search.on('keyup', function (event) {
        var searchText = qSwitcher.$search.val();

        if (qSwitcher.searchDelayTimeout) {
          clearTimeout(qSwitcher.searchDelayTimeout);
          qSwitcher.searchDelayTimeout = null;
        }

        if (searchText !== qSwitcher.searchText) {
          qSwitcher.searchDelayTimeout = setTimeout(function () {
            qSwitcher.selectIndex(null);
            qSwitcher.searchText = searchText;
            qSwitcher.renderList();
          }, qSwitcher.searchDelay);
        } else if (event.which === 8 && '' === searchText) { // backspace with text box blank
          qSwitcher.popCallback();
          qSwitcher.renderList();
        }
      });
      this.$domElement.on('hover', '.lstr-qswitcher-results li', function () {
        var $li = $(this);
        qSwitcher.selectIndex($li.data('lstr-qswitcher').index);
      });
      this.$domElement.on('click', '.lstr-qswitcher-results li', function (event) {
        var $li = $(this);
        qSwitcher.triggerSelect($li.data('lstr-qswitcher').index, event);
      });
    },

    renderList: function () {
      if (this.abortSearchCallback) {
        this.abortSearchCallback();
        this.abortSearchCallback = null;
      }

      this.renderBreadcrumb();

      this.usePane(this.$loading);

      var resultHandler = Object.create(ResultHandler);
      ++this.searchId;
      resultHandler.setResults = this.setResults.bind(this, this.searchId);
      resultHandler.setError = this.setError.bind(this, this.searchId);
      this.abortSearchCallback = this.searchCallback(this.searchText, resultHandler);
    },

    setResults: function (searchId, items) {
      // if the search ID provided to setResults is not the current searchId,
      // ignore the results
      if (searchId !== this.searchId) {
        return;
      }

      var qSwitcher = this;

      qSwitcher.valueObjects = [];

      if (items.length == 0) {
        this.$results.html('');
        this.usePane(this.searchText ? this.$noResults : this.$noSearchTerms);
        return;
      }

      var $ul = $('<ul>');

      items.forEach(function (value, index) {
        var $li = $('<li>');
        var $container = $('<div>');
        $ul.append($li);
        $li.append($container);
        qSwitcher.setListText($container, value);

        if (value.description) {
          var $description = $('<span class="lstr-qswitcher-results-description"></span>');
          qSwitcher.setListText($description, value.description);
          $li.prepend($description);
        }

        $li.data('lstr-qswitcher', {'index': index});
        $container.addClass('lstr-qswitcher-result-container');

        if (value.searchCallback) {
          $li.addClass('lstr-qswitcher-result-category');
        }

        qSwitcher.valueObjects[index] = {
          'index': index,
          'value': value,
          '$li': $li
        };
      });

      this.$results.html($ul);
      this.usePane(this.$results);

      qSwitcher.selectIndex(0);
    },

    setError: function (searchId) {
      if (searchId !== this.searchId) {
        return;
      }

      this.usePane(this.$oopsResults);
    },

    renderBreadcrumb: function ()
    {
      var $ul = $('<ul>');

      this.callbackStack.forEach(function (value, index) {
        var $li = $('<li>');
        $li.text(value.text);
        $ul.append($li);
      });

      this.$breadcrumb.html($ul);
    },

    setListText: function ($element, value) {
      if (value.toHtml || value.html) {
        $element.html(value.toHtml ? value.toHtml() : value.html);
        return;
      }

      if (value.toText || value.text) {
        $element.text(value.toText ? value.toText() : value.text);
        return;
      }

      $element.text(value);
    },

    selectIndex: function (selectedIndex) {
      if (this.selectedIndex !== null && this.valueObjects[this.selectedIndex]) {
        this.valueObjects[this.selectedIndex].$li.removeClass('lstr-qswitcher-result-selected');
      }

      if (null === selectedIndex) {
        this.selectedIndex = null;
        return;
      }

      this.selectedIndex = selectedIndex % this.valueObjects.length;

      if (this.selectedIndex < 0) {
        this.selectedIndex = this.valueObjects.length - 1;
      }

      this.valueObjects[this.selectedIndex].$li.addClass('lstr-qswitcher-result-selected');
    },

    scrollToSelectedItem: function () {
      var $li = this.valueObjects[this.selectedIndex].$li;
      var $results = this.$results;

      var topOfLi = $li.offset().top - $li.parent().offset().top;
      var bottomOfLi = topOfLi + $li.outerHeight(true);
      var scrollTop = $results.scrollTop();
      var scrollBottom = scrollTop + $results.outerHeight(true);

      if (bottomOfLi > scrollBottom || topOfLi < scrollTop) {
        $results.scrollTop(topOfLi);
      }
    },

    toggleSwitcher: function () {
      this.useRootCallback();
      this.$search.val('');
      this.renderList();

      this.$parentDom.toggleClass('lstr-qswitcher-noscroll');
      this.$search.focus();
    },

    closeSwitcher: function () {
      this.$parentDom.removeClass('lstr-qswitcher-noscroll');
    },

    triggerSelect: function (index, event) {
      if (null === index) {
        return;
      }

      var selectedValue = this.valueObjects[index].value;

      if (selectedValue.searchCallback) {
        this.callbackStack.push({
          'text': selectedValue.breadcrumbText,
          'parentSearchCallback': this.searchCallback,
          'parentSearchDelay': this.parentSearchDelay,
          'parentSelectCallback': this.selectCallback
        });

        this.searchCallback = selectedValue.searchCallback;
        if (selectedValue.searchDelay) {
          this.searchDelay = selectedValue.searchDelay;
        }
        if (selectedValue.selectCallback) {
          this.selectCallback = selectedValue.selectCallback;
        }

        this.valueObjects = [];
        this.selectIndex(null);
        this.$search.val('');
        this.renderList();

        return;
      }

      if (false !== this.selectCallback(selectedValue, event)) {
        this.closeSwitcher();
      }
    },

    popCallback: function () {
      var callbacks = this.callbackStack.pop();
      if (!callbacks) {
        return false;
      }

      this.searchCallback = callbacks.parentSearchCallback;
      this.searchDelay = callbacks.parentSearchDelay;
      this.selectCallback = callbacks.parentSelectCallback;

      return true;
    },

    useRootCallback: function () {
      while (this.callbackStack.length > 0) {
        this.popCallback();
      }
    },

    usePane: function ($paneToUse) {
      this.$results.hide();
      this.$noSearchTerms.hide();
      this.$noResults.hide();
      this.$oopsResults.hide();
      this.$loading.hide();

      $paneToUse.show();
    }
  };

  lstrQuickSwitcher = function (searchCallback, selectCallback, options) {
    var $parentDom = $('body');

    var quickSwitcher = Object.create(QuickSwitcher);
    quickSwitcher.init($parentDom, searchCallback, selectCallback, options);
  };

  if (typeof initLstrQuickSwitcher === 'function') {
    initLstrQuickSwitcher(lstrQuickSwitcher);
  }

  return lstrQuickSwitcher;
});
