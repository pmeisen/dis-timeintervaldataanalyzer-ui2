module.exports = function (grunt) {

    /*
     * Configuration settings
     */
    var bowerPaths = {
        bowerrc: '.bowerrc',
        bowerDirectory: 'bower_components',
        bowerJson: 'bower.json'
    };

    grunt.loadNpmTasks('grunt-contrib-connect');
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-sync-json');
    grunt.loadNpmTasks('grunt-bower-install-simple');
    grunt.loadNpmTasks('main-bower-files');
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-execute');
    grunt.loadNpmTasks('grunt-publish');
    grunt.loadNpmTasks('grunt-bump');
    grunt.loadNpmTasks('grunt-replace');
    grunt.loadNpmTasks('grunt-replace');
    grunt.loadNpmTasks('grunt-contrib-compress');

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),

        'sync-json': {
            options: {
                indent: 2,
                include: [
                    'name', 'version', 'description', 'authors', 'main', 'repository', 'keywords', 'license', 'private'
                ]
            },
            dep: {
                files: {
                    'bower.json': 'package.json'
                }
            }
        },

        /*
         * Task used to install bower dependencies.
         */
        'bower-install-simple': {
            dep: {
                options: {
                    production: false
                }
            }
        },

        /*
         * Modify the bower dependencies and move the needed files to the
         * target location.
         */
        bower: {
            dep: {
                options: {
                    includeDev: true,
                    checkExistence: true,
                    paths: bowerPaths,
                    overrides: {
                        'r.js': {main: ['dist/r.js']},
                        'bootstrap': {main: ['dist/js/bootstrap.js']},
                        'bootstrap-colorpicker': {main: ['dist/js/bootstrap-colorpicker.js']},
                        'js-misc': {ignore: true},
                        'js-svglibrary': {ignore: true},
                        'js-gantt': {ignore: true}
                    }
                },
                dest: 'www-root/scripts'
            }
        },

        /*
         * The watch tasks observes changes on the file-system, which
         * allow us to see changes directly in the browser.
         *
         * Set spawn == false, ee documentation: Setting this option to false speeds
         * up the reaction time of the watch (usually 500ms faster
         * for most)
         */
        watch: {
            server: {
                options: {
                    livereload: true,
                    spawn: false
                },

                // define the task to run when a change happens
                tasks: ['01-resolve-dependencies', 'copy:setup', 'replace:setup'],

                // files to observe, can be an array
                files: ['gruntfile.js', 'package.json', 'src/**/*', 'public/**/*', 'test/**/*']
            },
            dist: {
                options: {
                    livereload: true,
                    spawn: false
                },

                // define the task to run when a change happens
                tasks: ['02-compile-sources', 'copy:dist', 'replace:dist'],

                // files to observe, can be an array
                files: ['public/testDistribution*.html', 'src/Optimizer.js']
            }
        },

        /*
         * The connect task starts a web server for us to see our results and
         * do some testing.
         */
        connect: {
            server: {
                options: {
                    port: '<%= server.port %>',
                    base: 'www-root'
                }
            },
            dist: {
                options: {
                    port: '<%= server.port %>',
                    base: 'www-dist'
                }
            }
        },

        /*
         * Copies the files into the right location for the web server.
         */
        copy: {
            dep: {
                files: [
                    {
                        expand: true,
                        flatten: false,
                        cwd: bowerPaths.bowerDirectory + '/js-misc/src',
                        src: '**/*',
                        dest: 'www-root/scripts'
                    },
                    {
                        expand: true,
                        flatten: false,
                        cwd: bowerPaths.bowerDirectory + '/js-svglibrary/src',
                        src: '**/*',
                        dest: 'www-root/scripts'
                    },
                    {
                        expand: true,
                        flatten: false,
                        cwd: bowerPaths.bowerDirectory + '/js-gantt/src',
                        src: '**/*',
                        dest: 'www-root/scripts'
                    },
                    {
                        expand: true,
                        flatten: false,
                        cwd: bowerPaths.bowerDirectory + '/bootstrap/dist/css/',
                        src: 'bootstrap.css',
                        dest: 'www-root/css'
                    },
                    {
                        expand: true,
                        flatten: false,
                        cwd: bowerPaths.bowerDirectory + '/bootstrap/dist/fonts/',
                        src: '**/*',
                        dest: 'www-root/fonts'
                    },
                    {
                        expand: true,
                        flatten: false,
                        cwd: bowerPaths.bowerDirectory + '/bootstrap-colorpicker/dist/css/',
                        src: 'bootstrap-colorpicker.css',
                        dest: 'www-root/css'
                    }
                ]
            },
            setup: {
                files: [
                    {expand: true, flatten: false, cwd: 'src', src: '**/*', dest: 'www-root/scripts'},
                    {expand: true, flatten: false, cwd: 'test', src: '**/*', dest: 'www-root/scripts'},
                    {expand: true, flatten: false, cwd: 'public', src: '**/*', dest: 'www-root'}
                ]
            },
            dist: {
                files: [
                    {expand: true, flatten: false, cwd: 'dist', src: '**/*.js', dest: 'www-dist/js'},
                    {expand: true, flatten: false, cwd: 'public', src: '**/*', dest: 'www-dist'},
                    {
                        expand: true,
                        flatten: false,
                        cwd: bowerPaths.bowerDirectory + '/bootstrap/dist/css/',
                        src: 'bootstrap.css',
                        dest: 'www-dist/css'
                    },
                    {
                        expand: true,
                        flatten: false,
                        cwd: bowerPaths.bowerDirectory + '/bootstrap/dist/fonts/',
                        src: '**/*',
                        dest: 'www-dist/fonts'
                    },
                    {
                        expand: true,
                        flatten: false,
                        cwd: bowerPaths.bowerDirectory + '/bootstrap-colorpicker/dist/css/',
                        src: 'bootstrap-colorpicker.css',
                        dest: 'www-dist/css'
                    }
                ]
            }
        },

        replace: {
            setup: {
                options: {
                    patterns: [{
                        match: 'script-injection',
                        replacement: '<script data-main="scripts/net/meisen/dissertation/ui/app/App" src="scripts/require.js" type="text/javascript"></script>'
                    }]
                },
                files: [
                    {expand: true, flatten: false, src: ['www-root/*.html'], dest: '.'}
                ]
            },
            dist: {
                options: {
                    patterns: [{
                        match: 'script-injection',
                        replacement: '<script src="js/dis-tida-ui2.js" type="text/javascript"></script>'
                    }]
                },
                files: [
                    {expand: true, flatten: false, src: ['www-dist/*.html'], dest: '.'}
                ]
            }
        },

        execute: {
            compile: {
                call: function (grunt, option, async) {
                    var requirejs = require('requirejs');
                    var extend = require('util')._extend;
                    var fs = require('fs');

                    var done = async();
                    var currentDir = process.cwd();
                    var prefixFilename = currentDir + '/dist/' + grunt.config('pkg.name');

                    var baseConfig = {
                        baseUrl: 'scripts',
                        name: 'almond',
                        include: 'net/meisen/dissertation/ui/app/App',
                        wrap: true,
                        mainConfigFile: 'scripts/net/meisen/dissertation/ui/app/App.js'
                    };

                    var optimize = function (config, callback) {
                        requirejs.optimize(config, function () {
                            callback(true);
                        }, function (err) {
                            grunt.log.error(err);
                            callback(false);
                        });
                    };

                    var cleanUp = function () {
                        process.chdir(currentDir);
                        done();
                    };

                    // run the actual optimization
                    process.chdir('www-root');
                    optimize(extend({
                        optimize: 'none',
                        out: prefixFilename + '.js'
                    }, baseConfig), function (success) {

                        if (success) {
                            optimize(extend({
                                out: prefixFilename + '.min.js'
                            }, baseConfig), cleanUp);
                        } else {
                            cleanUp();
                        }
                    });
                }
            }
        },

        compress: {
            distZip: {
                options: {
                    mode: 'zip',
                    archive: 'dist/<%= pkg.name %>.zip'
                },
                files: [
                    {expand: true, flatten: false, cwd: 'www-dist', src: '**/*', dest: ''}
                ]
            },
            distTgz: {
                options: {
                    mode: 'tgz',
                    archive: 'dist/<%= pkg.name %>.tgz'
                },
                files: [
                    {expand: true, flatten: false, cwd: 'www-dist', src: '**/*', dest: ''}
                ]
            }
        },

        bump: {
            options: {
                files: ['package.json', 'bower.json'],
                commitFiles: ['.'],
                pushTo: 'origin'
            }
        }
    });

    grunt.registerTask('01-resolve-dependencies', 'Resolve all the dependencies', function () {
        grunt.task.run('sync-json:dep', 'bower-install-simple:dep', 'bower:dep', 'copy:dep');
    });

    grunt.registerTask('02-compile-sources', 'Update the current root-directory', function () {
        grunt.task.run('01-resolve-dependencies', 'copy:setup', 'replace:setup', 'execute:compile',
            'copy:dist', 'replace:dist', 'compress:distZip', 'compress:distTgz');
    });

    grunt.registerTask('04-deploy', 'Update the current root-directory', function () {
        grunt.task.run('02-compile-sources', 'bump');
    });

    grunt.registerTask('98-run-server', 'Start the web-server for fast debugging.', function (port) {
        port = typeof port === 'undefined' || port === null || isNaN(parseFloat(port)) || !isFinite(port) ? 20000 : parseInt(port);
        grunt.config.set('server.port', port);
        grunt.config.set('log.msg', 'You may want to start the sample server providing data via JSON, ant 98-run-server (see server)' + '\n' +
            'For an example: http://localhost:' + port + '/index.html');

        grunt.task.run('01-resolve-dependencies', 'copy:setup', 'replace:setup', 'connect:server', 'log', 'watch:server');
    });

    grunt.registerTask('99-run-dist-server', 'Runs a server with the dist-version', function (port) {
        port = typeof port === 'undefined' || port === null || isNaN(parseFloat(port)) || !isFinite(port) ? 20000 : parseInt(port);
        grunt.config.set('server.port', port);
        grunt.config.set('log.msg', 'Test the distribution:' + '\n' +
            '- run the server with ant 98-run-server (see server), and' + '\n' +
            '- visit http://localhost:' + port + '/index.html');

        grunt.task.run('02-compile-sources', 'connect:dist', 'log', 'watch:dist');
    });

    grunt.registerTask('log', 'Writes a log messages', function () {
        grunt.log.writeln(grunt.config.get('log.msg'));
    });
};