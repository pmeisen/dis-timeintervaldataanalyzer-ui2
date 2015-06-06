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
      loadModel: function (modelId, $table) {
        var _ref = this;

        util.handleLoading(function (callback) {
          tidaAPI.loadData(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, 0, 20, callback);
        }, function (status, data) {
          if (!status) return;

          // add all the data
          _ref.showModelData($table, data);
        }, 'Reloading data of model "' + modelId + '"...');
      },

      showModelData: function ($table, data) {
        var $thead = $table.children('thead');
        var $tbody = $table.children('tbody');

        // remove everything we have
        $thead.empty();
        $tbody.empty();

        // create the header
        var htmlHead = '';
        htmlHead += '<tr>';

        $.each(data.names, function (index, header) {
          htmlHead += '<th class="text-center col-xs-1 col-md-1 col-lg-1">' + header + '</th>';
        });
        htmlHead += '</tr>';
        $thead.append($(htmlHead));

        // create the body
        var _ref = this;
        var modelId = data.additional.query.model;
        $.each(data.result, function (index, row) {
          var id = null;

          var htmlRow = '';
          $.each(row, function (index, value) {
            id = index == 0 ? value : id;
            htmlRow += '<td class="text-center col-xs-1 col-md-1 col-lg-1">' + value + '</td>';
          });
          htmlRow = '<tr data-id="' + id + '" data-model="' + modelId + '">' + htmlRow + '</tr>';

          var $htmlRow = $(htmlRow);
          $tbody.append($htmlRow);

          // add the click event
          $htmlRow.click(function () {
            _ref.toggleSelection($(this));
          });
        });
      },

      updateDbModal: function (modelId) {
        this.updateModel(modelId, 'divLoadDbLoadingIcon', 'divLoadDbLoadingFailed', 'formDbData', 'divDbFields', 'btnLoadFromDb');
      },


      updateCsvModal: function (modelId) {
        this.updateModel(modelId, 'divLoadCsvLoadingIcon', 'divLoadCsvLoadingFailed', 'formCsvData', 'divCsvFields', 'btnLoadFromCsv');
      },

      updateSingleModal: function (modelId) {
        this.updateModel(modelId, 'divLoadSingleLoadingIcon', 'divLoadSingleLoadingFailed', 'formSingleData', 'divSingleFields', 'btnLoadSingle');
      },

      updateModelModal: function (modelId) {
        this.showData('divLoadModelLoadingIcon', 'divLoadModelLoadingFailed', 'divModelData', 'btnLoadFromModel');
      },

      updateModel: function (modelId, loadId, failId, dataId, fieldsId, btnId) {
        var _ref = this;
        tidaAPI.getModelStructure(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, function (status, data) {
          var $loadingFailed = $('#' + failId);

          if (status) {
            var $divDbFields = $('#' + fieldsId);

            $.each(data, function (index, entry) {

              // skip the id
              if (entry.metatype == 'ID') {
                return;
              }

              var entryHtml = '';
              entryHtml += '<div class="form-group form-group-sm">';
              entryHtml += '<label for="input' + entry.name + '" class="col-sm-4 control-label">' + entry.name + '</label>';
              entryHtml += '<div class="col-sm-8">';
              entryHtml += '<input type="input" class="form-control" id="input' + entry.name + '" placeholder="' + entry.name + '" data-metatype="' + entry.metatype + '" data-id="' + entry.name + '">';
              entryHtml += '</div>';
              entryHtml += '</div>';
              $divDbFields.append($(entryHtml));
            });

            _ref.showData(loadId, failId, dataId, btnId);
          } else {
            _ref.showError(loadId, failId, btnId, 'Unable to determine model structure', data);
          }
        });
      },

      showLoading: function (loadId, failId, dataId, btnId) {
        $('#' + loadId).removeClass('hide');
        $('#' + failId).addClass('hide');
        if (dataId != null) {
          $('#' + dataId).addClass('hide');
        }
        $('#' + btnId).attr('disabled', '');
      },

      showError: function (loadId, failId, btnId, title, data) {
        $('#' + loadId).addClass('hide');

        var $loadingFailed = $('#' + failId);
        $loadingFailed.children('h4').text(title);
        $loadingFailed.children('div').text(util.getError(data));
        $loadingFailed.removeClass('hide');
        $('#' + btnId).attr('disabled', '');
      },

      showData: function (loadId, failId, dataId, btnId) {
        $('#' + loadId).addClass('hide');
        if (failId != null) {
          $('#' + failId).addClass('hide');
        }
        $('#' + dataId).removeClass('hide');
        $('#' + btnId).removeAttr('disabled');
      },

      reset: function (loadId, failId, dataId, btnId, fieldsId) {
        var $loadingFailed = $('#' + failId);

        $('#' + loadId).removeClass('hide');
        $loadingFailed.addClass('hide');

        if (dataId != null) {
          $('#' + dataId).addClass('hide');
        }

        $loadingFailed.children('h4').text('');
        $loadingFailed.children('div').text('');

        if (fieldsId != null) {
          $('#' + fieldsId).empty();
        }
        $('#' + btnId).attr('disabled', '');
      },

      resetDbModal: function () {
        this.reset('divLoadDbLoadingIcon', 'divLoadDbLoadingFailed', 'formDbData', 'btnLoadFromDb', 'divDbFields');
      },

      resetCsvModal: function () {
        this.reset('divLoadCsvLoadingIcon', 'divLoadCsvLoadingFailed', 'formCsvData', 'btnLoadFromCsv', 'divCsvFields');
      },

      resetSingleModal: function () {
        this.reset('divLoadSingleLoadingIcon', 'divLoadSingleLoadingFailed', 'formSingleData', 'btnLoadSingle', 'divSingleFields');
      },

      resetModelModal: function () {
        this.reset('divLoadModelLoadingIcon', 'divLoadModelLoadingFailed', 'divModelData', 'btnLoadFromModel', null);
      },

      loadDbData: function (modelId) {
        var $textarea = $('#formDbData textarea');
        var $inputs = $('#formDbData input');

        var connection = {
          driver: $inputs.filter('#inputDriver').val(),
          url: $inputs.filter('#inputJdbc').val(),
          username: $inputs.filter('#inputDbUsername').val(),
          password: $inputs.filter('#inputDbPassword').val()
        };
        var query = $textarea.val();
        var structure = this.getStructure($inputs);

        var _ref = this;
        this.showLoading('divLoadDbLoadingIcon', 'divLoadDbLoadingFailed', 'formDbData', 'btnLoadFromDb');
        tidaAPI.insertDbData(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, connection, query, structure, function (status, data) {
          if (status) {
            var $modalLoadFromDb = $('#modalLoadFromDb');
            $modalLoadFromDb.modal('hide');
            $modalLoadFromDb.attr('data-dorefresh', 'true');
          } else {
            _ref.showError('divLoadDbLoadingIcon', 'divLoadDbLoadingFailed', 'btnLoadFromDb', 'Failed to load data in model', data);
            _ref.showData('divLoadDbLoadingIcon', null, 'formDbData', 'btnLoadFromDb');
          }
        });
      },

      loadCsvData: function (modelId) {
        var $inputs = $('#formCsvData input');
        var structure = this.getStructure($inputs);
        var separator = $inputs.filter('#inputSeparator').val();

        var _ref = this;
        this.showLoading('divLoadCsvLoadingIcon', 'divLoadCsvLoadingFailed', 'formCsvData', 'btnLoadFromCsv');
        tidaAPI.uploadFile(model.serverSettings.getCurrent(), model.session.getCurrent(), $('#formCsvData'), function (status, data) {
          if (status) {
            tidaAPI.insertCsvData(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, data[0].fileName, separator, structure, function (status, data) {
              if (status) {
                var $modalLoadFromCsv = $('#modalLoadFromCsv');
                $modalLoadFromCsv.modal('hide');
                $modalLoadFromCsv.attr('data-dorefresh', 'true');
              } else {
                _ref.showError('divLoadCsvLoadingIcon', 'divLoadCsvLoadingFailed', 'btnLoadFromCsv', 'Failed to add CSV data', data);
                _ref.showData('divLoadCsvLoadingIcon', null, 'formCsvData', 'btnLoadFromCsv');
              }
            });
          } else {
            _ref.showError('divLoadCsvLoadingIcon', 'divLoadCsvLoadingFailed', 'btnLoadFromCsv', 'Failed to upload file to server', data);
            _ref.showData('divLoadCsvLoadingIcon', null, 'formCsvData', 'btnLoadFromCsv');
          }
        });
      },

      loadModelData: function (modelId) {
        var _ref = this;
        this.showLoading('divLoadModelLoadingIcon', 'divLoadModelLoadingFailed', 'divModelData', 'btnLoadFromModel');
        tidaAPI.insertModelData(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, function (status, data) {
          if (status) {
            var $modalLoadFromModel = $('#modalLoadFromModel');
            $modalLoadFromModel.modal('hide');
            $modalLoadFromModel.attr('data-dorefresh', 'true');
          } else {
            _ref.showError('divLoadModelLoadingIcon', 'divLoadModelLoadingFailed', 'btnLoadFromModel', 'Failed to load data from model', data);
            _ref.showData('divLoadModelLoadingIcon', null, 'divModelData', 'btnLoadFromModel');
          }
        });
      },

      loadSingleRecord: function (modelId) {
        var $inputs = $('#formSingleData input');
        var entries = this.getEntries($inputs);

        var _ref = this;
        this.showLoading('divLoadSingleLoadingIcon', 'divLoadSingleLoadingFailed', 'formSingleData', 'btnLoadSingle');
        tidaAPI.insertSingleRecord(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, entries, function (status, data) {
          if (status) {
            var $modalLoadSingle = $('#modalLoadSingle');
            $modalLoadSingle.modal('hide');
            $modalLoadSingle.attr('data-dorefresh', 'true');
          } else {
            _ref.showError('divLoadSingleLoadingIcon', 'divLoadSingleLoadingFailed', 'btnLoadSingle', 'Failed to insert record', data);
            _ref.showData('divLoadSingleLoadingIcon', null, 'formSingleData', 'btnLoadSingle');
          }
        });
      },

      deleteModelData: function ($table, $row, modelId, recordId) {
        var _ref = this;
        tidaAPI.deleteRecord(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, recordId, function (status, data) {
          if (status) {

            // remove the entry and update the nav
            _ref.toggleSelection(null);

            // remove the modal
            var $modalDeleteData = $('#modalDeleteData');
            $modalDeleteData.modal('hide');
            $modalDeleteData.attr('data-dorefresh', 'true');
          } else {
            _ref.showError('divDeleteDataLoadingIcon', 'divDeleteDataLoadingFailed', 'btnDeleteFromModel', 'Failed to delete record from model', data);
            _ref.showData('divDeleteDataLoadingIcon', null, 'divDeleteData', 'btnDeleteFromModel');
          }
        });
      },

      toggleSelection: function ($row) {
        if ($row == null || typeof($row) == 'undefined') {
          $('#datamanagement nav').find('button[data-needselect="true"]').attr('disabled', 'disabled');
        } else {
          $row.parent().children('tr').removeClass('info');
          $row.addClass('info');

          $('#datamanagement nav').find('button[data-needselect="true"]').removeAttr('disabled');
        }
      },

      getStructure: function ($inputs) {
        var structure = [];

        $inputs.filter('[data-metatype]').each(function () {
          var $input = $(this);
          var metaType = $input.attr('data-metatype');

          var obj = {};
          if (metaType == 'DESCRIPTOR') {
            obj["descriptor"] = $input.attr('data-id');
          } else {
            obj["interval"] = metaType;
          }
          obj['column'] = $input.val();

          structure.push(obj);
        });

        return structure;
      },

      getEntries: function ($inputs) {
        var entries = [];

        $inputs.filter('[data-metatype]').each(function () {
          var $input = $(this);

          var obj = {
            id: $input.attr('data-id'),
            metatype: $input.attr('data-metatype'),
            value: $input.val()
          };
          entries.push(obj);
        });

        return entries;
      },

      initDriversAndUrl: function ($drivers, $url) {
        var drivers = ['com.mysql.jdbc.Driver', 'org.postgresql.Driver', 'COM.ibm.db2.jdbc.app.DB2Driver', 'com.microsoft.jdbc.sqlserver.SQLServerDriver',
          'oracle.jdbc.driver.OracleDriver', 'org.hsqldb.jdbcDriver', 'org.gjt.mm.mysql.Driver', 'net.meisen.dissertation.jdbc.TidaDriver'];
        var urls = ['jdbc:mysql://[host]:[port]/[db]', 'jdbc:postgresql://[host]:[port]/[db]', 'jdbc:db2://[host]:[port]/[db]', 'jdbc:sqlserver://[host]:[port];databaseName=[db];',
          'jdbc:oracle:thin:@[host]:[port]:[sid]', 'jdbc:hsqldb:hsql://[host]:[port]/[db]', 'jdbc:mysql://[host]:[port]/[db]', 'jdbc:tida://@[host]:[port]'];

        $drivers.typeahead({
          source: drivers, autoSelect: true, minLength: 0
        });

        $url.typeahead({
          source: urls, autoSelect: true, minLength: 0
        });
      }
    };
  });