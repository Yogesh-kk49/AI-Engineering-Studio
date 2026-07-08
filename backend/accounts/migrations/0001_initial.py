# Generated manually (no local Django install available in this sandbox
# to run `makemigrations`), mirroring the format Django itself produces.
# Regenerate with `python manage.py makemigrations accounts --check` on a
# real dev machine if this ever drifts from the model.

from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='EmailOTP',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('email', models.EmailField(db_index=True, max_length=254)),
                ('code_hash', models.CharField(max_length=128)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField()),
                ('is_used', models.BooleanField(default=False)),
                ('attempts', models.PositiveSmallIntegerField(default=0)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='emailotp',
            index=models.Index(fields=['email', 'is_used', '-created_at'], name='accounts_em_email_c9f3b1_idx'),
        ),
    ]