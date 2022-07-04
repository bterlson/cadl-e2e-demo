# Demo

This demo will build an application that saves a comment to cosmos (using MongoDB APIs), adding a sentiment score using the text analysis service. A website will save the comment and display the sentiment score.

The application will consist of the following components:

* azd integration (azd up)
* Functions app for backend
* Static website for frontend
* Cosmos mongodb for database
* Keyvault for secrets
* Monitor for monitoring
* (Stretch) APIM frontend

## Flow

Checked means ready to demo.

* [x] Initialize empty demo folder
* [ ] Create `app.cadl`:
  * [x] define a service namespace
  * [x] Import `cadl-data-store`
  * [ ] Import `cadl-azure-functions`
  * [ ] Define a service namespace, add `@AzureFunction` to it.
  * [ ] define model for a comment (with and without a sentiment score)
    * How should we do this composition? Visibility framework or spread with two declared models?
  * [x] Add the store decorator to models
  * [ ] Define two functions, one to create a comment, one to read a comment.
* [x] Run `cadl compile`
* [ ] Create `src/api/index.ts`, import the generated function host, and implement the create endpoint using the typed DB bindings. But we have an error because we haven't added the sentiment score.
* [ ] Type `cadl use <something pointing to text analytics sentiment endpoint>` in the terminal.
* [ ] Add the call to get sentiment and add it to the comment.
* [ ] Implement the read endpoint
* [ ] Create `src/web/build/index.html`, import the generated client, and create a text area and submit button, add a click event handler that saves the comment in the text box.
* [ ] Add a div above the text box, update the code to take the sentiment from the response and display it in the div.
* [ ] Add a new field to the comment, createdBy, that takes a string. Regenerate code and show how we get errors for code we need to update.
* [ ] Stretch: import `cadl-azure-api-management`, add `@APIM` to the service namespace, add `@APIM.IngressRule` to the create endpoint.
* [ ] Run `cadl compile` again
* [ ] Run `azd up`
* [ ] Demonstrate the running application, including the portal showing the monitor endpoint, `azd monitor` to tail logs, etc.
