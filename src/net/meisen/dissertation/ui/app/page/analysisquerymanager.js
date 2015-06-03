define([
    'jquery',
    'highcharts',
    'net/meisen/ui/gantt/GanttChart',
    'net/meisen/general/date/DateLibrary',
    'net/meisen/dissertation/ui/app/utilities',
    'net/meisen/dissertation/ui/app/model',
    'net/meisen/dissertation/ui/app/server/tidaAPI'
  ],
  function ($,
            highcharts,
            ganttcharts,
            DateLibrary,
            util,
            model,
            tidaAPI) {

    // regular expressions to check what type of query we have
    var timeSeriesRegExp = /^\s*select\s+timeseries/i;
    var intervalRegExp = /^\s*select\s+records/i;

    var resize = function () {
      var $highcharts = $('#highcharts');

      if (!$highcharts.hasClass('hide') && $highcharts.size() > 0) {
        var width = $highcharts.width();
        var height = $highcharts.height();

        $highcharts.children('#graph').highcharts().setSize(width, height, false);
      }

      var $ganttcharts = $('#ganttcharts');
      if (!$ganttcharts.hasClass('hide') && $ganttcharts.size() > 0) {
        var width = $ganttcharts.width();
        var height = $ganttcharts.height();

        $ganttcharts.children('#graph').ganttChart().resize(width, height);
      }
    };

    // add a resize event to change the sizing of the charts
    $(window).resize(function () {
      resize();
    });

    return {
      showResult: function (query) {
        if (timeSeriesRegExp.test(query)) {
          this.showTimeSeries(query);
        } else if (intervalRegExp.test(query)) {
          this.showGanttChart(query);
        } else {
          this.clean();
        }
      },

      showTimeSeries: function (query) {
        this.clean();

        var _ref = this;
        util.handleLoading(function (callback) {
          tidaAPI.query(model.serverSettings.getCurrent(), model.session.getCurrent(), query, callback);
        }, function (status, data) {
          if (!status) {
            return;
          }

          var $container = $('#highcharts');
          var $highchart = $('<div id="graph"></div>');
          $highchart.appendTo($container);

          // get the names of the entries
          var categories = data.names;
          var yAxisName = categories.shift();

          // determine the size of the tickInterval
          var tickInterval = 1;
          while (Math.ceil(categories.length / tickInterval) > 20) {
            tickInterval = tickInterval == 1 ? 5 : tickInterval + 5;
          }

          var series = [];
          for (var i = 0; i < data.result.length; i++) {
            var seriesData = data.result[i];
            var seriesName = seriesData.shift();
            series.push({
              name: seriesName,
              data: seriesData
            });
          }

          $highchart.highcharts({
            chart: {
              type: 'line'
            },
            title: {
              text: ''
            },
            xAxis: {
              tickInterval: tickInterval,
              categories: categories
            },
            yAxis: {
              floor: 0,
              title: {text: ''},
              allowDecimals: false
            },
            plotOptions: {
              line: {
                animation: false
              }
            },
            series: series
          });

          // show it and resize
          $container.removeClass('hide');
          resize();

        }, 'Waiting for response to query...');
      },

      showGanttChart: function (query) {
        this.clean();

        var _ref = this;
        util.handleLoading(function (callback) {
          tidaAPI.query(model.serverSettings.getCurrent(), model.session.getCurrent(), query, callback);
        }, function (status, data) {
          if (!status) {
            return;
          }

          var $container = $('#ganttcharts');
          var $ganttchart = $('<div id="graph"></div>');
          $ganttchart.appendTo($container);

          var queryInfo = data.additional.query;

          // we have to parse the date of the server to be correct
          for (var i = 0; i < data.result.length; i++) {
            var record = data.result[i];

            record[1] = DateLibrary.parseString(record[1], 'dd.MM.yyyy HH:mm:ss');
            record[2] = DateLibrary.parseString(record[2], 'dd.MM.yyyy HH:mm:ss');
          }

          var names = data.names;
          var tooltipFormatter = function (interval, map, record) {
            var entries = map.get('tooltip', record);

            var result = '';
            var entriesSize = entries.length;
            for (var i = 0; i < entriesSize; i++) {
              var name = names[i];
              var entry = '{' + (i + 1) + '}';

              result += '<span style="font-weight: bold">' + name + '</span>: ' + entry;
              result += '\n';
            }

            return result.trim();
          };

          $ganttchart.ganttChart({
            // activate if debugging is necessary:
            // throwException: true,
            data: {
              names: names,
              records: data.result,
              timeaxis: {
                start: DateLibrary.parseString(queryInfo.interval.start, 'dd.MM.yyyy HH:mm:ss'),
                end: DateLibrary.parseString(queryInfo.interval.end, 'dd.MM.yyyy HH:mm:ss'),
                granularity: queryInfo.timeaxis.granularity
              },
              mapper: {
                startname: '[START]',
                endname: '[END]',
                tooltip: names
              }
            },
            illustrator: {
              config: {
                axis: {
                  viewSize: 1440,
                  tickInterval: 120
                },
                view: {
                  showBorder: false,
                  tooltip: tooltipFormatter,
                  theme: {
                    intervalBorderSize: 0
                  }
                },
              }
            }
          });

          // show it and resize
          $container.removeClass('hide');
          resize();

        }, 'Waiting for response to query...');
      },

      clean: function () {
        var $ganttcharts = $('#ganttcharts');
        var $highcharts = $('#highcharts');
        var $charts = $highcharts.children('#graph');

        // clean-up any available high-chart
        if ($charts.size() > 0) {
          var highchart = $charts.highcharts();
          if (highchart != null && typeof(highchart) != 'undefined') {
            highchart.destroy();
          }
        }

        // remove everything
        $highcharts.empty();
        $ganttcharts.empty();

        // hide it
        $highcharts.addClass('hide');
        $ganttcharts.addClass('hide');
      }
    }
  }
);
