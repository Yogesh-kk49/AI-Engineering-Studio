from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('analyzer', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='repositoryanalysis',
            name='branch',
            field=models.CharField(blank=True, help_text='Branch that was analyzed. Empty = repository default branch.', max_length=255),
        ),
        migrations.AddField(
            model_name='repositoryanalysis',
            name='celery_task_id',
            field=models.CharField(blank=True, db_index=True, max_length=255),
        ),
        migrations.AddField(
            model_name='repositoryanalysis',
            name='progress_percent',
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='repositoryanalysis',
            name='progress_message',
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name='repositoryanalysis',
            name='error_message',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='repositoryanalysis',
            name='started_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='repositoryanalysis',
            name='completed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='repositoryanalysis',
            name='commit_sha',
            field=models.CharField(blank=True, db_index=True, max_length=64),
        ),
        migrations.AlterField(
            model_name='repositoryanalysis',
            name='status',
            field=models.CharField(
                choices=[
                    ('Queued', 'Queued'),
                    ('Cloning', 'Cloning'),
                    ('Scanning', 'Scanning'),
                    ('AI Analysis', 'AI Analysis'),
                    ('Generating Report', 'Generating Report'),
                    ('Completed', 'Completed'),
                    ('Failed', 'Failed'),
                ],
                db_index=True,
                default='Queued',
                max_length=30,
            ),
        ),
        migrations.AddIndex(
            model_name='repositoryanalysis',
            index=models.Index(fields=['repo_url', 'branch', 'commit_sha'], name='analyzer_re_repo_ur_5e0f8a_idx'),
        ),
    ]