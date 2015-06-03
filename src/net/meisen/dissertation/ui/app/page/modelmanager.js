define([
    'jquery',
    'net/meisen/dissertation/ui/app/utilities',
    'net/meisen/dissertation/ui/app/model',
    'net/meisen/dissertation/ui/app/server/tidaAPI'
  ],
  function ($,
            util,
            model,
            tidaAPI) {

    return {
      toggleModel: function (nav, row) {
        if (row == null || typeof(row) == 'undefined') {
          nav.find('button[data-needselect="true"]').attr('disabled', 'disabled');
        } else {
          row.parent().children('tr').removeClass('info');
          row.addClass('info');

          this.setNavBar(nav, row);
        }
      },

      setNavBar: function (nav, row) {
        var selBased = nav.find('button[data-needselect="true"]');
        selBased.each(function () {
          var selBasedRow = $(this);
          var attr = selBasedRow.attr('data-value');
          if (typeof(attr) == 'undefined') {
            selBasedRow.removeAttr('disabled');
          } else {

            // validate the value
            var invert = false;
            if (attr.charAt(0) == '!') {
              invert = true;
              attr = attr.substring(1, attr.length);
            }

            var value = row.data('entity');
            value = value != null && $.isPlainObject(value) ? value[attr] : null;
            if (value != null && value === !invert) {
              selBasedRow.removeAttr('disabled');
            } else {
              selBasedRow.attr('disabled', 'disabled');
            }
          }
        });
      },

      reloadModels: function (table) {
        var _ref = this;

        table.empty();
        this.toggleModel($('#modelmanagement nav'));

        // call the server to get the models
        util.handleLoading(function (callback) {
          tidaAPI.getModels(model.serverSettings.getCurrent(), model.session.getCurrent(), callback);
        }, function (status, data) {
          if (!status) return;

          // add all the data
          $.each(data, function (index, value) {
            _ref.addModel(table, value.model, value.loaded, value.autoloaded, false);
          });

          _ref.sortModels(table);
        }, 'Reloading models...');
      },

      uploadModel: function (table, form, autoload) {
        var _ref = this;

        util.handleLoading(function (callback) {

          // upload the file
          tidaAPI.uploadFile(model.serverSettings.getCurrent(), model.session.getCurrent(), form, function (status, data) {
            if (!status) {
              callback(status, data);
              return;
            }
            if (data.length != 1) {
              callback(false, {error: 'Invalid amount of files'});
              return;
            }

            // the file is uploaded, now we have to add the model
            tidaAPI.loadModelFromFile(model.serverSettings.getCurrent(), model.session.getCurrent(), data[0].fileName, autoload, function (status, data) {
              tidaAPI.getModels(model.serverSettings.getCurrent(), model.session.getCurrent(), callback);
            });
          });
        }, function (status, data) {
          if (!status) return;

          // check the result and load the new once
          $.each(data, function (index, value) {
            if (table.find('tr td:nth-child(1):contains(' + value.model + ')').size() == 0) {
              _ref.addModel(table, value.model, value.loaded, value.autoloaded, true);
            }
          });
        }, 'Adding model...');
      },

      deleteModel: function (row) {
        var _ref = this;
        var modelId = row.data('entity').name;

        util.handleLoading(function (callback) {
          tidaAPI.deleteModel(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, callback);
        }, function (status, data) {
          if (!status) return;

          // remove the row and update menu
          row.remove();
          _ref.toggleModel($('#modelmanagement nav'));
        }, 'Deleting model "' + modelId + '"...');
      },

      loadModel: function (row) {
        var _ref = this;
        var modelId = row.data('entity').name;

        util.handleLoading(function (callback) {
          tidaAPI.loadModel(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, callback);
        }, function (status, data) {
          if (!status) return;

          // update the entry
          _ref.setModel(row, null, true, null);
        }, 'Loading model "' + modelId + '"...');
      },

      unloadModel: function (row) {
        var _ref = this;
        var modelId = row.data('entity').name;

        util.handleLoading(function (callback) {
          tidaAPI.unloadModel(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, callback);
        }, function (status, data) {
          if (!status) return;

          // update the entry
          _ref.setModel(row, null, false, null);
        }, 'Unloading model "' + modelId + '"...');
      },

      addModel: function (table, name, loaded, autoload, sort) {
        var html = '';
        html += '<tr>';
        html += '  <td></td>';
        html += '  <td class="hidden-xs hidden-sm text-center"><span class="glyphicon" aria-hidden="true"></span></td>';
        html += '  <td class="hidden-xs hidden-sm text-center"><span class="glyphicon" aria-hidden="true"></span></td>';
        html += '  <td class="text-center">';
        html += '    <button type="button" class="btn operator" aria-label="load model"><span class="glyphicon glyphicon-play" aria-hidden="true"></span></button>';
        html += '    <button type="button" class="btn operator" aria-label="unload model"><span class="glyphicon glyphicon-stop" aria-hidden="true"></span></button>';
        html += '    <button type="button" class="btn operator" data-toggle="modal" data-target="#modalDeleteModel" data-backdrop="static" aria-label="delete model"><span class="glyphicon glyphicon-trash" aria-hidden="true"></span></button>';
        html += '  </td>';
        html += '</tr>';
        var row = $(html);

        // set the values of the model and append it
        this.setModel(row, name, loaded, autoload);
        row.appendTo(table);

        // add event for click
        var _ref = this;
        row.click(function (event) {
          var target = $(event.target);
          if (target.hasClass('operator') || target.parent().hasClass('operator')) {
            // do nothing
          } else {
            _ref.toggleModel($('#modelmanagement nav'), $(this));
          }
        });

        // click load
        row.find('button:nth-child(1)').click(function () {
          _ref.loadModel(row);
        });

        // click unload
        row.find('button:nth-child(2)').click(function () {
          _ref.unloadModel(row);
        });

        // click delete
        row.find('button:nth-child(3)').click(function () {
          _ref.toggleModel($('#modelmanagement nav'), row);
        });

        if (sort === true) {
          this.sortModels(table);
        }
      },

      sortModels: function (table) {
        table.find('tr').sort(function (tr1, tr2) {
          var valTr1 = $(tr1).find('td:first').text();
          var valTr2 = $(tr2).find('td:first').text();

          return valTr1.toLowerCase() > valTr2.toLowerCase() ? 1 : -1;
        }).appendTo(table);
      },

      setIcon: function (icon, status) {
        if (status) {
          icon.addClass('glyphicon-ok');
          icon.removeClass('glyphicon-remove');
        } else {
          icon.addClass('glyphicon-remove');
          icon.removeClass('glyphicon-ok');
        }
      },

      setModel: function (row, name, loaded, autoload) {
        var data = row.data('entity');
        data = $.isPlainObject(data) ? data : {};

        if (typeof(name) != 'undefined' && name != null) {
          row.children(':nth-child(1)').text(name);
          data.name = name;
        }

        if (typeof(loaded) == 'boolean' && loaded != null) {
          this.setIcon(row.find(':nth-child(2) span'), loaded);
          data.loaded = loaded;
        }
        if (typeof(autoload) == 'boolean' && autoload != null) {
          this.setIcon(row.find(':nth-child(3) span'), autoload);
          data.autoload = autoload;
        }

        // set the new entity for the object
        row.data('entity', data);

        var operators = row.children(':nth-child(4)');
        if (data.loaded) {
          operators.children('button:nth-child(1)').attr('disabled', 'disabled');
          operators.children('button:nth-child(2)').removeAttr('disabled');
        } else {
          operators.children('button:nth-child(1)').removeAttr('disabled');
          operators.children('button:nth-child(2)').attr('disabled', 'disabled');
        }

        if (row.hasClass('info')) {
          this.setNavBar($('#modelmanagement nav'), row);
        }
      }
    };
  });