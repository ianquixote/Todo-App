const { dbQuery } = require("./db-query");
const bcrypt = require("bcrypt");

module.exports = class PgPersistence {
  constructor(session) {
    this.username = session.username;
  }

  async authenticated(username, password) {
    const FIND_PASSWORD = "SELECT password FROM users " +
                          "WHERE username = $1";

    let result = await dbQuery(FIND_PASSWORD, username);
    if (result.rowCount === 0) return false;

    return bcrypt.compare(password, result.rows[0].password);
  }
  //returns a copy of the list of todo lists sorted by completion status
  //and title (case-insensitive)
  async sortedTodoLists() {
    const ALL_TODOLISTS = "SELECT * FROM todolists WHERE username = $1 " +
    "ORDER BY lower(title) ASC";
    const ALL_TODOS = "SELECT * FROM todos WHERE username = $1";

    let resultTodoLists = dbQuery(ALL_TODOLISTS, this.username);
    let resultTodos = dbQuery(ALL_TODOS, this.username);
    let resultBoth = await Promise.all([resultTodoLists, resultTodos]);

    let allTodoLists = resultBoth[0].rows;
    let allTodos = resultBoth[1].rows;
    if (!allTodoLists || !allTodos) return undefined;

    allTodoLists.forEach(todoList => {
      todoList.todos = allTodos.filter(todo => {
        return todoList.id === todo.todolist_id;
      });
    });

    return this._partitionTodoLists(allTodoLists);
  }

  //returns a new list of todo lists partioned by completion status
  _partitionTodoLists(todoLists) {
    let done = [];
    let undone = [];

    todoLists.forEach(todoList => {
      if (this.isDoneTodoList(todoList)) {
        done.push(todoList);
      } else {
        undone.push(todoList);
      }
    });

    return undone.concat(done);
  }

  isDoneTodoList(todoList) {
    return todoList.todos.length > 0 && todoList.todos.every(todo => todo.done);
  }

  // Does the todo list have any undone todos? Returns true if yes, false if no.
  hasUndoneTodos(todoList) {
    return todoList.todos.some(todo => !todo.done);
  }

  async sortedTodos(todoList) {
    const SORTED_TODOS = "SELECT * FROM todos " +
                         "WHERE todolist_id = $1 AND username = $2 " +
                         "ORDER BY done ASC, lower(title) ASC";

    let todos = await dbQuery(SORTED_TODOS, todoList.id, this.username);
    return todos.rows;
  }

  // Find a todo list with the indicated ID. Returns `undefined` if not found.
  // Note that `todoListId` must be numeric.
  async loadTodoList(todoListId) {
    const FIND_TODOLIST = "SELECT * FROM todolists " +
                          "WHERE id = $1 AND username = $2";
    const FIND_TODOS = "SELECT * FROM todos " +
                       "WHERE todolist_id = $1 AND username = $2";

    //Both queries produce a pending promise and race condition which is handled by await Promise.all
    let resultTodoList = dbQuery(FIND_TODOLIST, todoListId, this.username);
    let resultTodos = dbQuery(FIND_TODOS, todoListId, this.username);
    let resultBoth = await Promise.all([resultTodoList, resultTodos]);

    let todoList = resultBoth[0].rows[0];
    if (!todoList) return undefined;

    todoList.todos = resultBoth[1].rows;
    return todoList;
  }

  // Toggle a todo between the done and not done state. Returns a promise that
  // resolves to `true` on success, `false` if the todo list or todo doesn't
  // exist. The id arguments must both be numeric.
  async toggleDoneTodo(todoListId, todoId) {
    const TOGGLE_DONE = "UPDATE todos SET done = NOT done " +
                        "WHERE todolist_id = $1 AND id = $2 AND username = $3";

    let result = await dbQuery(TOGGLE_DONE, todoListId, todoId, this.username);
    return result.rowCount > 0;
  }

  // Find a todo with the indicated ID in the indicated todo list. Returns
  // `undefined` if not found. Note that both `todoListId` and `todoId` must be
  // numeric.
  async loadTodo(todoListId, todoId) {
    const FIND_TODO = "SELECT * FROM todos " +
                      "WHERE todolist_id = $1 AND id = $2 AND username = $3";

    let result = await dbQuery(FIND_TODO, todoListId, todoId, this.username);
    return result.rows[0];
  }

  async removeTodoFromTodoList(todoListId, todoId) {
    const DELETE_TODO = "DELETE FROM todos " +
                        "WHERE todolist_id = $1 AND id = $2 AND username = $3";

    let result = await dbQuery(DELETE_TODO, todoListId, todoId, this.username);
    return result.rowCount > 0;
  }

  // Mark all todos in the specified todo list as done. Returns a promise that
  // resolves to `true` on success, `false` if the todo list doesn't exist. The
  // todo list ID must be numeric.
  async markAllDone(todoListId) {
    const MARK_ALL_DONE = "UPDATE todos SET done = true " +
                          "WHERE todolist_id = $1 AND username = $2";

    let result = await dbQuery(MARK_ALL_DONE, todoListId, this.username);
    return result.rowCount > 0;
  }

  async addTodo(todoTitle, todoListId) {
    const ADD_TITLE = "INSERT INTO todos (title, todolist_id, username) " +
                      "VALUES ($1, $2, $3)";

    let result = await dbQuery(ADD_TITLE, todoTitle, todoListId, this.username);
    return result.rowCount > 0;
  }

  async deleteTodoList(todoListId)  {
    const DELETE_TODOLIST = "DELETE FROM todolists " +
                            "WHERE id = $1 AND username = $2";

    let result = await dbQuery(DELETE_TODOLIST, todoListId, this.username);
    return result.rowCount > 0;
  }

  // Returns a Promise that resolves to `true` if a todo list with the specified
  // title exists in the list of todo lists, `false` otherwise.
  async existsTodoListTitle(title) {
    const FIND_TODOLIST = "SELECT null FROM todolists " +
                          "WHERE title = $1 AND username = $2";

    let result = await dbQuery(FIND_TODOLIST, title, this.username);
    return result.rowCount > 0;
  }

  async createTodoList(title) {
    const CREATE_TODOLIST = "INSERT INTO todolists (title, username) " +
                            "VALUES ($1, $2)";

    try {
      let results = await dbQuery(CREATE_TODOLIST, title, this.username);
      return results.rowCount > 0;
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) return false;
      throw error;
    }
  }

  async setTitle(todoListId, title) {
    const UPDATE_TITLE = "UPDATE todolists SET title = $1 " +
                         "WHERE id = $2 AND username = $3";

    let results = await dbQuery(UPDATE_TITLE, title, todoListId, this.username);
    return results.rowCount > 0;
  }

  // Returns `true` if `error` seems to indicate a `UNIQUE` constraint
  // violation, `false` otherwise.
  isUniqueConstraintViolation(error) {
    return /duplicate key value violates unique constraint/.test(String(error));
  }
};
