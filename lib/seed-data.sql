INSERT INTO todolists (id, title, username)
  VALUES (1, 'Work Todos', 'admin'),
         (2, 'Home Todos', 'admin'),
         (3, 'Additional Todos', 'admin'),
         (4, 'social Todos', 'admin');

INSERT INTO todos (title, done, todolist_id, username)
  VALUES('Get coffee', true, 1, 'admin'),
        ('Chat with co-workers', true, 1, 'admin'),
        ('Duck out of meeting', false, 1, 'admin'),
        ('Feed the cats', true, 2, 'admin'),
        ('Go to bed', true, 2, 'admin'),
        ('Buy milk', true, 2, 'admin'),
        ('Study for Launch School', true, 2, 'admin'),
        ('Go to Libby''s birthday party', false, 4, 'admin');
