define([
    'jquery',
    'highcharts',
    'typeahead',
    'bootstrap-colorpicker',
    'net/meisen/ui/gantt/GanttChart',
    'net/meisen/general/date/DateLibrary',
    'net/meisen/dissertation/ui/app/utilities',
    'net/meisen/dissertation/ui/app/model',
    'net/meisen/dissertation/ui/app/server/tidaAPI'
  ],
  function ($,
            highcharts,
            typeahead,
            colorpicker,
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
          $('#highchartsNav').removeClass('hide');
          resize();

        }, 'Waiting for response to query...');
      },

      showGanttChart: function (query, settings) {
        var settings = typeof(settings) == 'undefined' || settings == null ? null : settings;
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
                tooltip: names,
                group: settings == null ? [] : settings.group,
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
                  coloring: {
                    groupMapping: settings == null ? null : settings.mappings,
                  },
                  theme: {
                    intervalBorderSize: 0
                  }
                }
              }
            }
          });

          // modify the settings
          _ref.modifyGanttChartSettings(data.names, $('#inputGroupDescriptor'));

          // show it and resize
          $container.removeClass('hide');
          $('#ganttchartsNav').removeClass('hide');
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
        $('#highchartsNav').addClass('hide');
        $('#ganttchartsNav').addClass('hide');
      },

      /*
       * Gantt Chart Settings
       */
      modifyGanttChartSettings: function (names, $inputGroupDescriptor) {
        var descNames = $.grep(names, function (element, idx) {
          if (element.indexOf('[') == 0) {
            return false;
          } else {
            return true;
          }
        });

        // add values to typeahead
        $inputGroupDescriptor.typeahead('destroy');
        $inputGroupDescriptor.typeahead({
          source: descNames, autoSelect: true, minLength: 0
        });
      },

      initGanttChartSettings: function ($modal, $nav, $table, $descriptors, $acceptButton, $resetButton, $addGroupButton, $addMappingButton, $openColorPickerButton, $inputGroupDescriptor, $inputGroup, callback) {
        this.resetGanttChartSettings($nav, $acceptButton, $openColorPickerButton, $table, $descriptors);

        // remove all group descriptors
        $descriptors.empty();

        // add click event and validate
        var _ref = this;
        $.each($nav.children('[data-selector]'), function (idx, element) {
            var $el = $(element);
            var $selector = $($el.attr('data-selector'));

            // add the click
            $el.click(function () {
              if ($el.hasClass('disabled')) {
                return;
              }
              var $children = $nav.children('[data-selector]');

              // reset everything
              $children.removeClass('active');

              // select the current one
              $el.addClass('active');
              $selector.removeClass('hide');

              _ref.selectActiveGanttChartStep($nav);
            })
          }
        );

        // add a custom event used to trigger the adding
        $inputGroupDescriptor.bind('addGanttChartGroupDescriptor', function () {
          _ref.addGanttChartGroupDescriptor($nav, $acceptButton, $descriptors, $table, $inputGroupDescriptor);
        });
        $addGroupButton.click(function () {
          $inputGroupDescriptor.trigger('addGanttChartGroupDescriptor');
        });

        // add the color picker
        $openColorPickerButton.colorpicker({
          align: 'left'
        });
        $openColorPickerButton.on('changeColor.colorpicker', function (event) {
          var hexColor = event.color.toHex();
          $openColorPickerButton.css('background', hexColor);
          $openColorPickerButton.attr('data-color', hexColor);
        });
        this.setRandomColor($openColorPickerButton);

        // bind an event to the input
        $inputGroup.bind('addGanttChartMapping', function () {
          _ref.addGanttChartMapping($nav, $acceptButton, $descriptors, $table, $openColorPickerButton, $inputGroup);
        });
        $addMappingButton.click(function () {
          $inputGroup.trigger('addGanttChartMapping');
        });

        // add click to main buttons $acceptButton and $resetButton
        var setSettings = function (settings) {
          $modal.modal('hide');

          // apply the settings
          callback(settings);
        };
        $acceptButton.click(function () {

          var groups = $table.find('thead th[data-descriptor]');
          var resGroups = [];
          $.each(groups, function (idx, group) {
            var $group = $(group);

            // get the group value
            var desc = $group.attr('data-descriptor');
            resGroups.push(desc);
          });

          var mappings = $table.find('tbody tr');
          var resMappings = {};
          $.each(mappings, function (idx, mapping) {
            $mapping = $(mapping);

            // get the values defined for the mapping
            var values = [];
            $.each($mapping.find('td[data-value]'), function (idx, value) {
              values.push('"' + $(value).attr('data-value') + '"');
            });
            var color = $mapping.find('td[data-color]').attr('data-color');

            resMappings['[' + values.join(',') + ']'] = color;
          });

          setSettings({
            group: resGroups,
            mappings: resMappings
          });
        });
        $resetButton.click(function () {
          setSettings({});
        });

        // validate initially
        this.validateGanttChartSetting($nav, $acceptButton, $table, $descriptors);
      },

      resetGanttChartSettings: function ($nav, $acceptButton, $openColorPickerButton, $table, $descriptors) {
        $table.find('thead tr th:not(:first-child):not(:last-child)').remove();
        $table.children('tbody').empty();
        $descriptors.empty();

        $nav.children('[data-selector]').removeClass('active');
        $nav.children(':first-child').addClass('active');

        this.validateGanttChartSetting($nav, $acceptButton, $table, $descriptors);
        this.selectActiveGanttChartStep($nav);

        this.setRandomColor($openColorPickerButton);
      },

      setRandomColor: function ($openColorPickerButton) {
        if (typeof($openColorPickerButton.data('colorpicker')) == 'undefined') {
          return;
        }

        var color = '#' + (Math.random() * 0xFFFFFF << 0).toString(16);
        $openColorPickerButton.colorpicker('setValue', color);
        $openColorPickerButton.colorpicker('update', true);
      },

      selectActiveGanttChartStep: function ($nav) {
        $.each($nav.children('[data-selector]'), function (idx, element) {
          var $el = $(element);
          var $selector = $($el.attr('data-selector'));

          if ($el.hasClass('active')) {
            $selector.removeClass('hide');
          } else {
            $selector.addClass('hide');
          }
        });
      },

      validateGanttChartSetting: function ($nav, $acceptButton, $table, $descriptors) {
        var valid = true;

        // validate the descriptors selected
        if ($descriptors != null) {
          if ($descriptors.children('[data-descriptor]').size() == 0) {
            $nav.children('[data-selector="#stepColorDefinition"]').addClass('disabled');
            valid = false;
          } else {
            $nav.children('[data-selector="#stepColorDefinition"]').removeClass('disabled');
          }
        } else {
          valid = false;
        }

        // check the table
        if ($table != null) {
          var $tbody = $table.children('tbody');
          if ($tbody.children('tr').size() == 0) {
            valid = false;
          } else if ($tbody.find('td:not([data-value])[data-descriptor]').size() > 0) {
            valid = false;
          }
        } else {
          valid = false;
        }

        // overall
        if (valid) {
          $acceptButton.removeAttr('disabled');
        } else {
          $acceptButton.attr('disabled', '');
        }
      },

      addGanttChartGroupDescriptor: function ($nav, $acceptButton, $descriptors, $table, $inputGroupDescriptor) {
        var value = $inputGroupDescriptor.val();

        // check if a value was defined
        if (value.trim() == '') {
          return;
        }
        // check if already added
        else if ($descriptors.children('[data-descriptor="' + value + '"]').size() > 0) {
          return;
        }
        // check if the value is available
        else if (!this.isValidGroupDescriptor($inputGroupDescriptor)) {
          return;
        }

        var _ref = this;
        var $entry = $('<a href="#" title="remove ' + value + '" data-descriptor="' + value + '"><span class="label label-primary">' + value + '</span></a><span>&nbsp;</span>');
        $descriptors.append($entry);
        var position = $descriptors.size();

        // modify the table
        var $thead = $table.children('thead');
        var $tbody = $table.children('tbody');

        var $theadEntry = $('<th data-descriptor="' + value + '" class="text-center">' + value + '</th>');
        $theadEntry.insertBefore($thead.find('tr :last-child'));

        // add missing values
        $.each($tbody.find('tr'), function (idx, element) {
          var $el = $(element);
          var $tbodyEntry = $('<td data-descriptor="' + value + '"></td>');
          $tbodyEntry.insertBefore($el.children(':last-child'));
        });

        // add the remove event
        $entry.click(function () {
          $entry.remove();
          $theadEntry.remove();
          $tbody.find('tr td[data-descriptor="' + value + '"]').remove();

          _ref.validateGanttChartSetting($nav, $acceptButton, $table, $descriptors);
        });

        // remove the value
        $inputGroupDescriptor.val('');
        this.validateGanttChartSetting($nav, $acceptButton, $table, $descriptors);
      },

      isValidGroupDescriptor: function ($inputGroupDescriptor) {
        var value = $inputGroupDescriptor.val();
        var values = $inputGroupDescriptor.data('typeahead');
        values = values == null || typeof(values) == 'undefined' || !$.isArray(values.source) ? [] : values.source;

        return $.inArray(value, values) != -1;
      },

      addGanttChartMapping: function ($nav, $acceptButton, $descriptors, $table, $openColorPickerButton, $inputGroup) {
        var color = $openColorPickerButton.attr('data-color');
        var group = $inputGroup.val().split(',');

        // check the group
        var $thead = $table.children('thead');
        if (group.length != $thead.find('th').size() - 2) {
          return;
        }

        var $tbody = $table.children('tbody');
        var tbodyEntry = '<tr>';
        tbodyEntry += '<td class="text-center"><button type="button" class="btn operator" aria-label="delete mapping"><span class="glyphicon glyphicon-trash" aria-hidden="true"></span></button></td>'

        var valid = [];
        $.each(group, function (idx, val) {
          var value = val.trim();
          var desc = $thead.find('th:nth-child(' + (idx + 2) + ')').attr('data-descriptor');
          tbodyEntry += '<td data-value="' + value + '" data-descriptor="' + desc + '">' + value + '</td>';

          // mark if the on is unique
          valid.push('td:nth-child(' + (idx + 1) + ')[data-value="' + value + '"]');
        });
        tbodyEntry += '<td class="text-center" data-color="' + color + '"><span><i style="display: inline-block; width: 16px; height: 16px; vertical-align: text-top; background-color:' + color + '"></i></span></td>';
        tbodyEntry += '</tr>';

        // another entry already exists
        var all = null;
        $.each(valid, function (idx, selector) {
          var tr = $tbody.find(selector).parent().toArray();
          all = all == null ? tr : $(all).filter(tr);
        });

        // if we found a duplicate stop here
        if (all.length > 0) {
          return;
        }

        var $tbodyEntry = $(tbodyEntry);
        $tbody.append($tbodyEntry);

        // add the remove functionality
        var _ref = this;
        $tbodyEntry.find('button').click(function () {
          $(this).parent().parent().remove();
          _ref.validateGanttChartSetting($nav, $acceptButton, $table, $descriptors);
        });

        // set a new value
        $inputGroup.val('');
        this.setRandomColor($openColorPickerButton);
        this.validateGanttChartSetting($nav, $acceptButton, $table, $descriptors);
      },

      createGanttChartSettings: function ($nav, $descriptors) {
        var settings = {};

        $.each($nav.children('[data-selector]'), function (idx, element) {
          var $el = $(element);
          var $selector = $($el.attr('data-selector'));

          // handle each element
          var id = $selector.attr('id');
          if (id == 'stepGroupDescriptors') {
            settings.group = [];

            $.each($descriptors.children(), function (idx, element) {
              var $el = $(element);
              var desc = $el.attr('data-descriptor');
              settings.group.push(desc);
            });
          } else if (id == 'stepColorDefinition') {

          }
        });
      }
    }
  }
)
;
