define([
        'jquery',
        'bootstrap3-typeahead',
        'net/meisen/dissertation/ui/app/model',
        'net/meisen/dissertation/ui/app/server/tidaAPI',
        'net/meisen/dissertation/ui/app/utilities',
        'net/meisen/dissertation/ui/app/page/modelmanager',
        'net/meisen/dissertation/ui/app/page/analysisquerymanager',
        'net/meisen/dissertation/ui/app/page/usermanager',
        'net/meisen/dissertation/ui/app/page/datamanager'
    ],
    function ($,
              typeahead,
              model,
              tidaAPI,
              util,
              modelmanager,
              analysisquerymanager,
              usermanager,
              datamanager) {

        var changePage = function (item) {
            var selector = item.attr('data-target');

            // show the correct page
            $('.container-fluid .main').addClass('hide');
            $(selector).removeClass('hide');

            // select the correct button in the nav
            $('.container-fluid li').removeClass('active');
            $('.container-fluid li a span.sr-only').remove();
            item.parent().addClass('active');
            item.append('<span class="sr-only">(current)</span>');

            // do some page dependent stuff
            if (selector == '#modelmanagement') {
                modelmanager.reloadModels($('#tableModels tbody'));
                loadModels();
            } else if (selector == '#usermanagement') {
                usermanager.reloadUsersAndRoles($('#tableUsers tbody'), $('#tableRoles tbody'));
            } else if (selector == '#datamanagement') {
                loadModels();
            }

            // keep the map
            model.map.set('analyze.subpage', selector);
        };

        var toggleQuery = function (val) {
            var $queryPanel = $('#queryPanel');
            var $toggleQuery = $('#toggleQuery');

            val = typeof(val) == 'boolean' ? val : $queryPanel.hasClass('hide');
            if (val) {
                $queryPanel.removeClass('hide');
                $queryPanel.find('textarea').focus();
                $toggleQuery.removeClass('btn-default').addClass('btn-primary');
                model.map.set('analyze.toggleQuery', true);
            } else {
                $queryPanel.addClass('hide');
                $toggleQuery.removeClass('btn-primary').addClass('btn-default');
                model.map.set('analyze.toggleQuery', false);
            }
        };

        // function to load the models
        var loadModels = function (val) {
            var $inputModelSearch = $('input.modelSearch');
            tidaAPI.getModels(model.serverSettings.getCurrent(), model.session.getCurrent(), function (status, data) {
                if (status) {
                    $inputModelSearch.typeahead('destroy');

                    var filteredData = [];
                    $.each(data, function (idx, val) {
                        if (val.loaded) {
                            filteredData.push(val.model);
                        }
                    });
                    filteredData.sort();

                    $inputModelSearch.typeahead({
                        source: filteredData, autoSelect: true, minLength: 0
                    });
                } else {
                    $inputModelSearch.attr('disabled', '');
                }
            });
        };

        return function () {
            util.appendLogout();
            util.appendLoading();

            /*
             * General handling, reset values
             */
            $('[data-toggle=offcanvas]').click(function () {
                $('.row-offcanvas').toggleClass('active');
            });

            // select the right menu
            var subpage = model.map.get('analyze.subpage', '#modelmanagement');
            changePage($('.nav a[data-target="' + subpage + '"]'));

            // toggle the query
            var toggle = model.map.get('analyze.toggleQuery', true);
            toggleQuery(toggle);

            // reset a query set
            var query = model.map.get('analyze.query', '');
            $('#queryInput').val(query);

            // add click functionality to the buttons in the menu
            $('.nav a[data-target]').click(function () {
                changePage($(this));
            });

            // load the models were needed
            loadModels();

            /*
             * Model Management
             */
            // add some features for modals
            $('#btnAddModel').submit(function (event) {

                // check the autoload value
                var autoload = $('#modelAutoload').is(':checked');

                // fire the upload
                modelmanager.uploadModel($('#tableModels tbody'), $('#modalAddModel form'), autoload);
                $('#modalAddModel').modal('hide');

                // stop the submit event from being processed
                event.preventDefault();
            });
            $('#btnDeleteModel').click(function () {
                modelmanager.deleteModel($('#tableModels tbody tr.info'));
                $('#modalDeleteModel').modal('hide');
            });
            $('#btnRefreshModels').click(function () {
                modelmanager.reloadModels($('#tableModels tbody'));
            });
            $('#btnLoadModel').click(function () {
                modelmanager.loadModel($('#tableModels tbody tr.info'));
            });
            $('#btnUnloadModel').click(function () {
                modelmanager.unloadModel($('#tableModels tbody tr.info'));
            });

            /*
             * Data Management
             */
            datamanager.initDriversAndUrl($('#inputDriver'), $('#inputJdbc'));

            var $btnLoadData = $('#btnLoadData');
            $btnLoadData.click(function () {
                datamanager.loadModel($('#inputDataSearch').val(), $('#tableData'));
            });
            var $inputDataSearch = $('#inputDataSearch');
            $inputDataSearch.change(function () {
                var $buttons = $('#datamanagement .navbar-header button[data-needselect!="true"]');
                if ($inputDataSearch.val() == '') {
                    $buttons.attr('disabled', '');
                } else {
                    $buttons.removeAttr('disabled');
                }
            });
            var $modalLoadFromDb = $('#modalLoadFromDb');
            $modalLoadFromDb.on('show.bs.modal', function () {
                datamanager.resetDbModal();
                datamanager.updateDbModal($('#inputDataSearch').val());
            });
            $('#btnLoadFromDb').click(function () {
                datamanager.loadDbData($('#inputDataSearch').val());
            });
            var $modalLoadFromCsv = $('#modalLoadFromCsv');
            $modalLoadFromCsv.on('show.bs.modal', function () {
                datamanager.resetCsvModal();
                datamanager.updateCsvModal($('#inputDataSearch').val());
            });
            $('#btnLoadFromCsv').click(function () {
                datamanager.loadCsvData($('#inputDataSearch').val());
            });
            var $modalLoadFromModel = $('#modalLoadFromModel');
            $modalLoadFromModel.on('show.bs.modal', function () {
                datamanager.resetModelModal();
                datamanager.updateModelModal($('#inputDataSearch').val());
            });
            $('#btnLoadFromModel').click(function () {
                datamanager.loadModelData($('#inputDataSearch').val());
            });
            var $modalLoadSingle = $('#modalLoadSingle');
            $modalLoadSingle.on('show.bs.modal', function () {
                datamanager.resetSingleModal();
                datamanager.updateSingleModal($('#inputDataSearch').val());
            });
            $('#btnLoadSingle').click(function () {
                datamanager.loadSingleRecord($('#inputDataSearch').val());
            });
            $('.modal[data-refresh="modeldata"]').on('hidden.bs.modal', function (e) {
                var $this = $(this);
                var refresh = $this.attr('data-dorefresh');

                // do the refreshing
                if (refresh == 'true') {
                    datamanager.loadModel($('#inputDataSearch').val(), $('#tableData'));
                }

                // remove the attribute
                $this.removeAttr('data-dorefresh');
            });
            $('#btnDeleteDataFromModel').click(function () {
                var $table = $('#tableData');
                var $row = $table.find('tr.info');

                if ($row != null) {
                    datamanager.deleteModelData($table, $row, $row.attr('data-model'), $row.attr('data-id'));
                }
            });

            /*
             * User Management
             */
            $('#btnRefreshUsersAndRoles').click(function () {
                usermanager.reloadUsersAndRoles($('#tableUsers tbody'), $('#tableRoles tbody'));
            });

            /*
             * Analytics
             */
            var $queryInput = $('#queryInput');
            $('#closeQuery').click(toggleQuery);
            $('#toggleQuery').click(toggleQuery);
            $('button[data-action="queryReset"]').click(function () {
                $queryInput.val('');
            });
            $queryInput.on('input', function () {
                model.map.set('analyze.query', $queryInput.val());
            });
            $('button[data-action="queryFire"]').click(function () {
                analysisquerymanager.showResult($queryInput.val());
            });
            analysisquerymanager.initGanttChartSettings($('#modalGanttChartSettings'), $('#stepGanttChartSettingsSelector'), $('#tableMappings'), $('#selectedGroupDescriptor'),
                $('#btnAcceptGanttChartSettings'), $('#btnRemoveGanttChartSettings'), $('#btnAddGroupDescriptor'), $('#btnAddMapping'), $('#btnOpenColorPicker'), $('#inputGroupDescriptor'), $('#inputGroupMapper'), function (settings) {
                    analysisquerymanager.showGanttChart($queryInput.val(), settings);
                });
            var $modalGanttChartSettings = $('#modalGanttChartSettings');
            $modalGanttChartSettings.on('show.bs.modal', function () {
                analysisquerymanager.resetGanttChartSettings($('#stepGanttChartSettingsSelector'), $('#btnAcceptGanttChartSettings'), $('#btnOpenColorPicker'), $('#tableMappings'), $('#selectedGroupDescriptor'));
            });
            $('#formGroupSelection').submit(function (event) {
                $('#inputGroupDescriptor').trigger('addGanttChartGroupDescriptor');
                return false;
            });
            $('#formMappings').submit(function (event) {
                $('#inputGroupMapper').trigger('addGanttChartMapping');
                return false;
            });

            // make sure the modals are resetted
            $('.modal').on('hidden.bs.modal', function () {
                var form = $(this).find('form')[0];
                if (typeof(form) != 'undefined') {
                    form.reset();
                }
            });
        };
    });