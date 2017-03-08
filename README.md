# dis-timeintervaldataanalyzer-ui2
[![Build Status](https://travis-ci.org/pmeisen/dis-timeintervaldataanalyzer-ui2.svg?branch=master)](https://travis-ci.org/pmeisen/dis-timeintervaldataanalyzer-ui2)

This project creates the UI of the Time Interval Data Server. It is mentioned in the book [Time Interval Data Analysis](https://www.amazon.com/Analyzing-Time-Interval-Data-Introducing/dp/3658157275).
For further insights regarding the provided analytical capacities of the TIDAInformationSystem, the used TIDAModel and TIDAQueryLanguage have a look at the book or at the following research papers:

- [TIDAModel](https://www.researchgate.net/publication/266733554_Modeling_and_Processing_of_Time_Interval_Data_for_Data-Driven_Decision_Support)
- [TIDAQueryLanguage](https://www.researchgate.net/publication/275828232_TIDAQL_A_Query_Language_enabling_On-line_Analytical_Processing_of_Time_Interval_Data)
- [Indexing](https://www.researchgate.net/publication/274897254_Bitmap-Based_On-Line_Analytical_Processing_of_Time_Interval_Data)
- [Similarity](https://www.researchgate.net/publication/283712168_Similarity_Search_of_Bounded_TIDASETs_within_Large_Time_Interval_Databases)

If you'd like to test, play with, or develop the TIDAPlatform, please have a look at the umbrella/wrapper project [dis-timeintervaldataanalyzer-assembly](https://github.com/pmeisen/dis-timeintervaldataanalyzer-assembly).

## Front-End Development

When developing the front-end it is recommend to use the provided `grunt-tasks`. The provided `98-run-server` starts an HTTP-server, which automatically serves the currently available source-files. 
The UI is available via `http://localhost:20000/index.html`. To test the front-end it may be necessary to have a back-end server available. To start a back-end server in the background an `ant-target`
is available within this project `98-run-server`. When executed, a back-end server is started listing for HTTP request on `http://localhost:10000/`. So summarized:

1. start the front-end with `grunt`: `98-run-server` (the server will restart automatically if files are changed and a restart is needed)

   <p align="center">
     <img src="https://raw.githubusercontent.com/pmeisen/dis-timeintervaldataanalyzer-ui2/master/docs/intellij-grunt-run-server.png" alt="Start UI server" width="300">
   </p>

   <p align="center">
     <img src="https://raw.githubusercontent.com/pmeisen/dis-timeintervaldataanalyzer-ui2/master/docs/intellij-grunt-started.png" alt="Started UI server" width="460">
   </p>

2. start the back-end with `ant`: `98-run-server`

   <p align="center">
     <img src="https://raw.githubusercontent.com/pmeisen/dis-timeintervaldataanalyzer-ui2/master/docs/intellij-ant-run-server.png" alt="Start back-end server" width="300">
   </p>
   
   <p align="center">
     <img src="https://raw.githubusercontent.com/pmeisen/dis-timeintervaldataanalyzer-ui2/master/docs/intellij-ant-started.png" alt="Started back-end server" width="600">
   </p>
   
3. access the front-end via `http://localhost:20000/login.html`
4. change the used back-end server via `Change server`

<p align="center">
  <img src="https://raw.githubusercontent.com/pmeisen/dis-timeintervaldataanalyzer-ui2/master/docs/tida-change-server.png" alt="Change Server" width="230">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/pmeisen/dis-timeintervaldataanalyzer-ui2/master/docs/tida-server-settings.png" alt="Server Settings" width="460">
</p>

5. login with the username `admin` and the password `password`, the used back-end server is configured to use a `AuthenticationManager`, thus it is necessary to use these credentials

**Note**: It may be necessary to restart the server manually, if the dependencies are changed.

Further documentation regarding the usage of the available `grunt-tasks`, `troubleshooting`, and many more may be added in the future.