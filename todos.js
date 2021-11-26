const express = require("express"); //returns a function used for route handling and assigns it to the express constant
const morgan = require("morgan"); //used for logging status code information
const flash = require("express-flash"); //used for displaying flash messages
const session = require("express-session"); //provides features to manage sessions and cookies. Provides a default data store called MemoryStore, but doesn't persist data across application or browser restarts. MemoryStore should only be used in development, and never in production.
const { body, validationResult } = require("express-validator"); //provides methods which help to sanitize and validate user inputs
const store = require("connect-loki"); //provides a way to store data in a NoSQL data store. By default, it stores data in the 'session-store.db' file in the project directory.
const PgPersistence = require('./lib/pg-persistence'); //Class which provides methods to access and manipulate the session store
const catchError = require('./lib/catch-error');

const app = express(); //creates the application object by invoking the express function
const host = "localhost";
const port = 3000;
const LokiStore = store(session); //Creates a session store by passing the session-express object to the store function provided by connect-loki

app.set("views", "./views"); //tells express to look for view templates in the "views" directory
app.set("view engine", "pug"); //tells express that the view engine to be used is specifically the "pug" view engine

//Typically, app.use defines middlewares which must run for every HTTP request
app.use(morgan("common")); //Sets the status output log to the 'common' format so that the specific format doesn't need to be explicitly defined
app.use(express.static("public")); //Informs express to find and return static files in the 'public' directory. Note: requests for static assets bypass the route callbacks entirely.
app.use(express.urlencoded({ extended: false })); //parses the request body as URL-encoded text, and stores it in the req.body object. This allows access to the values which correspond to the "name" values in a form
app.use(session({
  cookie: {
    httpOnly: true, //if true, the browser cannot alter the value of the cookie and prevents JavaScript from accessing the cookie
    maxAge: 31 * 24 * 60 * 60 * 1000, // Sets the lifetime of the cookie, in this case to 31 days in millseconds. If not specified, the cookie will get deleted when the browser shuts down.
    path: "/", //Specifies the cookie's document location. This means that the browser only sends the cookie when the request URL matches the path.
    secure: false, //if false, the cookie can be sent over http and https. If true, the cookie can only be sent over https.
  },
  name: "launch-school-todos-session-id", //Provides a session name for session created by this application. (To differentiate it from other cookies from other apps?) This property is not required, but should always be added.
  resave: false, //
  saveUninitialized: true, //should always add this. If true, forces an 'uninitialized' session to be saved to the data store
  secret: "this is not very secure", //required. Used to sign and ecrypt the cookie to prevent tampering. This value is sensitive and must be protected. In most apps, obtain this value from an external source that is only available to the app's servers.
  store: new LokiStore({}), //defines an instance(?) of the data store used by express-session
}));

app.use(flash());

//create a new data store
app.use((req, res, next) => {
  res.locals.store = new PgPersistence(req.session); //Note: Data defined on res.locals has a lifetime limited to the current req/res cycle. Also note that data can be stored on res.locals to pass data from one middleware to another. Also note that data on res.locals can be accessed directly by view templates. Also note that req.session is needed to give the constructor access to the persisted data
  next();
});

// Extract session info
app.use((req, res, next) => {
  res.locals.username = req.session.username;
  res.locals.signedIn = req.session.signedIn;
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  next();
});

const requiresAuthentication = (req, res, next) => {
  if (!res.locals.signedIn) {
    res.redirect(302, "/users/signin");
  } else {
    next();
  }
};

// Redirect start page
app.get("/", (req, res) => {
  res.redirect("/lists");
});

// Render the list of todo lists,
//Note: the "render" method is used to convert view templates
//into HTML and send it to the client
app.get("/lists",
  requiresAuthentication,
  catchError(async (req, res) => {
    let store = res.locals.store;
    let todoLists = await store.sortedTodoLists();

    let todosInfo = todoLists.map(todoList => ({
      countAllTodos: todoList.todos.length,
      countDoneTodos: todoList.todos.filter(todo => todo.done).length,
      isDone: store.isDoneTodoList(todoList),
    }));

    res.render("lists", {
      todoLists,
      todosInfo
    });
  })
);

// Render new todo list page
app.get("/lists/new",
  requiresAuthentication,
  (req, res) => {
    res.render("new-list");
  }
);

// Render the sign in page
app.get("/users/signin", (req, res) => {
  req.flash("info", "Please sign in.");
  res.render("signin", {
    flash: req.flash(),
  });
});

app.post("/users/signout", (req, res) => {
  delete req.session.username;
  delete req.session.signedIn;
  res.redirect("/users/signin");
});

// Create a new todo list
app.post("/lists",
  requiresAuthentication,
  //validation chain used with express-validator's body method
  //to validate user input
  [
    body("todoListTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The list title is required.")
      .isLength({ max: 100 })
      .withMessage("List title must be between 1 and 100 characters."),
  ],
  catchError(async (req, res) => {
    let store = res.locals.store;
    let errors = validationResult(req);
    let todoListTitle = req.body.todoListTitle;

    const rerenderNewList = () => {
      res.render("new-list", {
        todoListTitle,
        flash: req.flash(),
      });
    };

    if (!errors.isEmpty()) {
      errors.array().forEach(message => req.flash("error", message.msg));
      rerenderNewList();
    } else if (await store.existsTodoListTitle(todoListTitle)) {
      req.flash("error", "The list title must be unique.");
      rerenderNewList();
    } else {
      let created = await store.createTodoList(todoListTitle);
      if (!created) throw new Error("Failed to create todo list.");

      req.flash("success", "The todo list has been created.");
      res.redirect("/lists");
    }
  })
);

// Render individual todo list and its todos
app.get("/lists/:todoListId",
  requiresAuthentication,
  catchError(async (req, res) => {
    let store = res.locals.store;
    let todoListId = req.params.todoListId;
    let todoList = await store.loadTodoList(+todoListId);
    if (!todoList) throw new Error("Not found.");

    todoList.todos = await store.sortedTodos(todoList);

    res.render("list", {
      todoList,
      isDoneTodoList: store.isDoneTodoList(todoList),
      hasUndoneTodos: store.hasUndoneTodos(todoList),
    });
  })
);

// Toggle completion status of a todo
app.post("/lists/:todoListId/todos/:todoId/toggle",
  requiresAuthentication,
  catchError(async (req, res) => {
    let { todoListId, todoId } = { ...req.params };
    let toggled = await res.locals.store.toggleDoneTodo(+todoListId, +todoId);
    console.log(+todoId);
    if (!toggled) throw new Error("Not found.");

    let todo = await res.locals.store.loadTodo(+todoListId, +todoId);
    if (todo.done) {
      req.flash("success", `"${todo.title}" marked done.`);
    } else {
      req.flash("success", `"${todo.title}" marked as NOT done!`);
    }

    res.redirect(`/lists/${todoListId}`);
  })
);

// Delete a todo
app.post("/lists/:todoListId/todos/:todoId/destroy",
  requiresAuthentication,
  catchError(async (req, res) => {
    let { todoListId, todoId } = { ...req.params };
    let deleted = await res.locals.store.removeTodoFromTodoList(+todoListId, +todoId);
    if (!deleted) throw new Error("Not found.");

    req.flash("success", "The todo has been deleted.");
    res.redirect(`/lists/${todoListId}`);
  })
);

// Mark all todos as done
app.post("/lists/:todoListId/complete_all",
  requiresAuthentication,
  catchError(async (req, res) => {
    let todoListId = req.params.todoListId;
    let allDone = await res.locals.store.markAllDone(+todoListId);
    if (!allDone) throw new Error("Not found.");

    req.flash("success", "All todos have been marked as done.");
    res.redirect(`/lists/${todoListId}`);
  })
);

// Create a new todo and add it to the specified list
app.post("/lists/:todoListId/todos",
  [
    body("todoTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The todo title is required.")
      .isLength({ max: 100 })
      .withMessage("Todo title must be between 1 and 100 characters."),
  ],
  catchError(async (req, res) => {
    let todoListId = req.params.todoListId;
    let todoTitle = req.body.todoTitle;

    let todoList = await res.locals.store.loadTodoList(+todoListId);
    if (!todoList) throw new Error("Not found.");

    let errors = validationResult(req);
    if (!errors.isEmpty()) {
      errors.array().forEach(message => req.flash("error", message.msg));
      todoList.todos = await res.locals.store.sortedTodos(todoList);
      res.render("list", {
        todoList,
        todoTitle,
        flash: req.flash(),
        hasUndoneTodos: res.locals.store.hasUndoneTodos(todoList),
        isDoneTodoList: res.locals.store.isDoneTodoList(todoList),
      });
    } else {
      let added = await res.locals.store.addTodo(todoTitle, +todoListId);
      if (!added) throw new Error("Not found.");

      req.flash("success", "The todo has been created.");
      res.redirect(`/lists/${todoListId}`);
    }
  })
);

// Render edit todo list form
app.get("/lists/:todoListId/edit",
  requiresAuthentication,
  catchError(async (req, res) => {
    if (req.session.signedIn) {
      let todoListId = req.params.todoListId;
      let todoList = await res.locals.store.loadTodoList(+todoListId);
      if (!todoList) throw new Error("Not found.");
      res.render("edit-list", { todoList });
    } else {
      res.redirect("/lists");
    }
  })
);

// Delete todo list
app.post("/lists/:todoListId/destroy",
  requiresAuthentication,
  catchError(async (req, res) => {
    let todoListId = req.params.todoListId;
    console.log(req.params);
    let deleted = await res.locals.store.deleteTodoList(+todoListId);
    if (!deleted) throw new Error("Not found.");
    req.flash("success", "Todo list deleted.");
    res.redirect("/lists");
  })
);

// Edit todo list title
app.post("/lists/:todoListId/edit",
  requiresAuthentication,
  [
    body("todoListTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The list title is required.")
      .isLength({ max: 100 })
      .withMessage("List title must be between 1 and 100 characters."),
  ],
  catchError(async (req, res) => {
    let store = res.locals.store;
    let todoListId = req.params.todoListId;
    let todoListTitle = req.body.todoListTitle;

    const rerenderEditList = async () => {
      let todoList = await store.loadTodoList(+todoListId);
      if (!todoList) throw new Error("Not found.");

      res.render("edit-list", {
        todoListTitle,
        todoList,
        flash: req.flash(),
      });
    };
    try {
      let errors = validationResult(req);
      if (!errors.isEmpty()) {
        errors.array().forEach(message => req.flash("error", message.msg));
        await rerenderEditList();
      } else if (await store.existsTodoListTitle(todoListTitle)) {
        req.flash("error", "The list title must be unique.");
        await rerenderEditList();
      } else {
        let updated = await store.setTitle(+todoListId, todoListTitle);
        if (!updated) throw new Error("Not found.");

        req.flash("success", "Todo list updated.");
        res.redirect(`/lists/${todoListId}`);
      }
    } catch (error) {
      if (store.isUniqueConstraintViolation(error)) {
        req.flash("error", "The list title must be unique.");
        rerenderEditList();
      } else {
        throw error;
      }
    }
  })
);

app.post("/users/signin",
  catchError(async (req, res) => {
    let username = req.body.username.trim();
    let password = req.body.password;
    let authenticated = await res.locals.store.authenticated(username, password);

    if (!authenticated) {
      req.flash("error", "Invalid Credentials");
      res.render("signin", {
        flash: req.flash(),
        username: req.body.username,
      });
    } else {
      req.session.username = username;
      req.session.signedIn = true;
      req.flash("info", "Welcome!");
      res.redirect("/lists");
    }
  })
);

// Error handler
app.use((err, req, res, _next) => {
  console.log(err); // Writes more extensive information to the console log on the server
  res.status(404).send(err.message); //writes a brief error message on the client which is given by the error object thrown by the "next" middleware
});

// Listener
app.listen(port, host, () => {
  console.log(`Todos is listening on port ${port} of ${host}!`);
});
