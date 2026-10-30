(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  // Catalog order by JLPT level, starting at the learning plan's target: the
  // target level first, then the harder levels up to N1, then any easier ones
  // (N3 reads N3, N2, N1, N4, N5). Entries without a level go last.
  var UNKNOWN = 99;

  function number(level) {
    var match = /^N([1-5])$/.exec(String(level || '').toUpperCase());
    return match ? Number(match[1]) : 0;
  }

  function target() {
    var store = root.ProgressStore;
    var plan = store && typeof store.getPlan === 'function' ? store.getPlan() : null;
    return (plan && plan.jlptTarget) || 'N5';
  }

  function rank(level, goal) {
    var n = number(level);
    var t = number(goal) || 5;
    if (!n) return UNKNOWN;
    return n <= t ? t - n : 10 + (n - t);
  }

  // Stable: entries of one level keep their relative order.
  function sort(items, getLevel, goal) {
    var read =
      typeof getLevel === 'function'
        ? getLevel
        : function (item) {
            return item && item.level;
          };
    var level = goal || target();
    return items
      .map(function (item, index) {
        return { item: item, index: index, rank: rank(read(item), level) };
      })
      .sort(function (a, b) {
        return a.rank - b.rank || a.index - b.index;
      })
      .map(function (entry) {
        return entry.item;
      });
  }

  app.levelOrder = Object.freeze({ target: target, rank: rank, sort: sort });
})(window);
