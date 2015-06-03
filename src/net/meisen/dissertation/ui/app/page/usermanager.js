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
      reloadUsersAndRoles: function(tableUsers, tableRoles) {
        var _ref = this;
        var server = model.serverSettings.getCurrent();
        var session = model.session.getCurrent();

        tableUsers.empty();
        tableRoles.empty();

        // call the server to get the models
        var users = [];
        var roles = [];
        util.handleLoading(function (callback) {
          tidaAPI.getUsers(server, session, function(status, data) {
            if (status) {
              users = data;
              tidaAPI.getRoles(server, session, callback);
            } else {
              callback(status, data);
            }
          });
        }, function (status, data) {
          if (!status) return;

          roles = data;

          // add all the data
          $.each(users.result, function (index, value) {
            _ref.add(tableUsers, 'user', {name: value[0], username: value[0], roles: value[1], permissions: value[2]}, false);
          });
          $.each(roles.result, function (index, value) {
            _ref.add(tableRoles, 'role', {name: value[0], role: value[0], permissions: value[1]}, false);
          });

          _ref.sort(tableUsers);
          _ref.sort(tableRoles);
        }, 'Reloading models...');
      },

      add: function(table, type, value, sort) {
        var casedType = type.charAt(0).toUpperCase() + type.slice(1);

        var html = '';
        html += '<tr>';
        html += '  <td></td>';
        html += '  <td class="text-right">';
        html += '    <button type="button" class="btn operator" data-toggle="modal" data-target="#modalEdit' + casedType + '" data-backdrop="static" aria-label="edit ' + type + '"><span class="glyphicon glyphicon-pencil" aria-hidden="true"></span></button>';
        html += '    <button type="button" class="btn operator" data-toggle="modal" data-target="#modalDelete' + casedType + '" data-backdrop="static" aria-label="delete ' + type + '"><span class="glyphicon glyphicon-trash" aria-hidden="true"></span></button>';
        html += '  </td>';
        html += '</tr>';
        var row = $(html);
        this.set(row, value);

        // set the values of the model and append it
        row.appendTo(table);

        if (sort === true) {
          this.sort(table);
        }
      },

      set: function (row, data) {
        data = $.extend({}, row.data('entity'), data);

        // set the name
        row.children(':nth-child(1)').text(data.name);

        // set the new entity for the object
        row.data('entity', data);

        if (row.hasClass('info')) {
          // this.setNavBar($('#modelmanagement nav'), row);
        }
      },

      sort: function (table) {
        table.find('tr').sort(function (tr1, tr2) {
          var valTr1 = $(tr1).find('td:first').text();
          var valTr2 = $(tr2).find('td:first').text();

          return valTr1.toLowerCase() > valTr2.toLowerCase() ? 1 : -1;
        }).appendTo(table);
      }
    };
  });